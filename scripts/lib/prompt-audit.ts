import { createHash, createHmac, randomBytes } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { asSchema } from 'ai';
import { setupRunner } from '../../packages/server/src/runtime/agent/runner/runner-setup.ts';
import type { ProviderName } from '../../packages/server/src/runtime/provider/index.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type AuditOptions = {
	projectRoot: string;
	agent: string;
	provider: string;
	model: string;
	mode: 'default' | 'oneshot';
	userText: string;
	freezeTime: string;
	hmacKey?: string;
};

export type PromptAuditArtifact = {
	format: 'agi-prompt-audit/v1';
	kind: 'full';
	createdAt: string;
	provenance: {
		pipeline: 'setupRunner';
		projectRoot: string;
		agent: string;
		provider: string;
		model: string;
		mode: string;
		freezeTime: string;
		inferenceExecuted: false;
		toolsExecuted: false;
	};
	regions: Array<{
		name: string;
		class: VolatilityClass;
		byteStart: number;
		byteEnd: number;
		bytes: number;
		sha256: string;
	}>;
	segments: Array<{
		name: string;
		components: string[];
		class: VolatilityClass;
		ordinal: number;
		charStart: number;
		charEnd: number;
		byteStart: number;
		byteEnd: number;
		chars: number;
		bytes: number;
		sha256: string;
	}>;
	system: string;
	messages: Array<{ role: string; content: unknown }>;
	tools: Array<{ name: string; description: string; inputSchema: Json }>;
	providerOptions: Json;
	maxOutputTokens?: number;
	volatileInputs: string[];
	layers: Record<LayerName, string>;
};

type VolatilityClass =
	| 'global-stable'
	| 'project-specific'
	| 'session-specific'
	| 'volatile';
type LayerName =
	| 'toolSerialization'
	| 'systemString'
	| 'messages'
	| 'finalRequestCanonical';

type LayerManifest = {
	chars: number;
	bytes: number;
	sha256: string;
	hmacSha256: string;
	prefixHmac64: string[];
};

export type PromptAuditManifest = {
	format: 'agi-prompt-audit/v1';
	kind: 'manifest';
	createdAt: string;
	comparisonKeyId: string;
	provenance: Omit<PromptAuditArtifact['provenance'], 'projectRoot'> & {
		projectRootHmac: string;
	};
	regions: PromptAuditArtifact['regions'];
	segments: PromptAuditArtifact['segments'];
	tools: Array<{
		ordinal: number;
		name: string;
		schemaHmac: string;
		descriptionHmac: string;
	}>;
	providerOptionsHmac: string;
	volatileInputs: string[];
	layers: Record<LayerName, LayerManifest>;
	warnings: string[];
};

export type Comparison = {
	left: string;
	right: string;
	layers: Record<
		LayerName,
		{ exactBytePrefix: number | null; leftBytes: number; rightBytes: number }
	>;
	firstDifferingSegment: {
		index: number;
		left?: string;
		right?: string;
	} | null;
	firstDifferingTool: { index: number; left?: string; right?: string } | null;
	firstDifferingPath: string | null;
	tokenPrefix: null;
	tokenNote: string;
};

const layerNames: LayerName[] = [
	'toolSerialization',
	'systemString',
	'messages',
	'finalRequestCanonical',
];

export async function createPromptAudit(
	options: AuditOptions,
): Promise<PromptAuditArtifact> {
	const projectRoot = resolve(options.projectRoot);
	return withFrozenTime(options.freezeTime, async () => {
		const setup = await setupRunner({
			sessionId: 'prompt-audit-session',
			assistantMessageId: 'prompt-audit-message',
			agent: options.agent,
			provider: options.provider as ProviderName,
			model: options.model,
			projectRoot,
			oneShot: options.mode === 'oneshot',
			omitHistory: true,
			userContent: options.userText,
		});
		const tools = Object.entries(setup.toolset).map(([name, value]) => {
			const tool = value as { description?: string; inputSchema?: unknown };
			let inputSchema: unknown = {};
			try {
				inputSchema = tool.inputSchema
					? asSchema(tool.inputSchema).jsonSchema
					: {};
			} catch {
				inputSchema = { $auditError: 'input schema could not be converted' };
			}
			return {
				name,
				description: tool.description ?? '',
				inputSchema: canonicalize(inputSchema) as Json,
			};
		});
		const messages = [
			...setup.history.map((message) => ({
				role: message.role,
				content: message.content,
			})),
			...setup.additionalSystemMessages,
			{ role: 'user', content: options.userText },
		];
		const segments = locateSegments(setup.system, setup.systemSegments);
		const regions = locateRegions(setup.system, segments, projectRoot);
		const providerOptions = canonicalize(setup.providerOptions) as Json;
		const toolSerialization = canonicalStringify(tools);
		const messageSerialization = canonicalStringify(messages);
		const finalRequestCanonical = canonicalStringify({
			maxOutputTokens: setup.maxOutputTokens,
			messages,
			providerOptions,
			system: setup.system,
			tools,
		});
		return {
			format: 'agi-prompt-audit/v1',
			kind: 'full',
			createdAt: options.freezeTime,
			provenance: {
				pipeline: 'setupRunner',
				projectRoot,
				agent: options.agent,
				provider: options.provider,
				model: options.model,
				mode: options.mode,
				freezeTime: options.freezeTime,
				inferenceExecuted: false,
				toolsExecuted: false,
			},
			regions,
			segments,
			system: setup.system,
			messages,
			tools,
			providerOptions,
			maxOutputTokens: setup.maxOutputTokens,
			volatileInputs: [
				'cwd/projectRoot and absolute paths',
				'date/time (frozen for this snapshot)',
				'project instruction files',
				'references',
				'skills',
				'MCP and plugin discovery',
				'terminal context',
				'session history and summaries (omitted)',
			],
			layers: {
				toolSerialization,
				systemString: setup.system,
				messages: messageSerialization,
				finalRequestCanonical,
			},
		};
	});
}

export function createManifest(
	artifact: PromptAuditArtifact,
	key?: string,
): PromptAuditManifest {
	const secret = key ?? randomBytes(32).toString('hex');
	const layers = Object.fromEntries(
		layerNames.map((name) => [
			name,
			describeLayer(artifact.layers[name], secret),
		]),
	) as Record<LayerName, LayerManifest>;
	return {
		format: artifact.format,
		kind: 'manifest',
		createdAt: artifact.createdAt,
		comparisonKeyId: createHash('sha256')
			.update(secret)
			.digest('hex')
			.slice(0, 16),
		provenance: {
			...artifact.provenance,
			projectRootHmac: hmac(secret, artifact.provenance.projectRoot),
			projectRoot: undefined,
		} as PromptAuditManifest['provenance'],
		regions: artifact.regions,
		segments: artifact.segments,
		tools: artifact.tools.map((tool, ordinal) => ({
			ordinal,
			name: tool.name,
			schemaHmac: hmac(secret, canonicalStringify(tool.inputSchema)),
			descriptionHmac: hmac(secret, tool.description),
		})),
		providerOptionsHmac: hmac(
			secret,
			canonicalStringify(artifact.providerOptions),
		),
		volatileInputs: artifact.volatileInputs,
		layers,
		warnings: [
			'Prompt bodies are omitted.',
			key
				? 'Prefix fingerprints are comparable only with manifests made using the same HMAC key.'
				: 'An ephemeral HMAC key was used; exact prefixes are only comparable in this process.',
			'Byte-prefix equality does not imply backend-token prefix equality.',
		],
	};
}

export async function writeFullArtifact(
	path: string,
	artifact: PromptAuditArtifact,
): Promise<void> {
	await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, {
		mode: 0o600,
	});
	await chmod(path, 0o600);
}

export function compareAudits(
	items: Array<{
		label: string;
		value: PromptAuditArtifact | PromptAuditManifest;
	}>,
): Comparison[] {
	if (items.length < 2)
		throw new Error('compare requires at least two artifacts or manifests');
	const base = items[0];
	return items.slice(1).map((item) => {
		const layers = Object.fromEntries(
			layerNames.map((name) => {
				const left = layerView(base.value, name);
				const right = layerView(item.value, name);
				return [
					name,
					{
						exactBytePrefix: exactPrefix(left, right),
						leftBytes: left.bytes,
						rightBytes: right.bytes,
					},
				];
			}),
		) as Comparison['layers'];
		const segmentIndex = firstDifferenceIndex(
			base.value.segments.map((segment) => `${segment.name}:${segment.sha256}`),
			item.value.segments.map((segment) => `${segment.name}:${segment.sha256}`),
		);
		const segment =
			segmentIndex === null
				? null
				: {
						index: segmentIndex,
						left: base.value.segments[segmentIndex]?.name,
						right: item.value.segments[segmentIndex]?.name,
					};
		const tool = firstDifference(
			base.value.tools.map((t) => t.name),
			item.value.tools.map((t) => t.name),
		);
		return {
			left: base.label,
			right: item.label,
			layers,
			firstDifferingSegment: segment,
			firstDifferingTool: tool,
			firstDifferingPath: firstDifferingPath(base.value, item.value),
			tokenPrefix: null,
			tokenNote:
				'No local backend tokenizer/template was used; byte equality is not claimed as token equality.',
		};
	});
}

function layerView(
	value: PromptAuditArtifact | PromptAuditManifest,
	name: LayerName,
) {
	if (value.kind === 'full') {
		const bytes = Buffer.from(value.layers[name]);
		return {
			bytes: bytes.length,
			raw: bytes,
			prefix: undefined as string[] | undefined,
			keyId: undefined as string | undefined,
		};
	}
	return {
		bytes: value.layers[name].bytes,
		raw: undefined,
		prefix: value.layers[name].prefixHmac64,
		keyId: value.comparisonKeyId,
	};
}

function exactPrefix(
	left: ReturnType<typeof layerView>,
	right: ReturnType<typeof layerView>,
): number | null {
	if (left.raw && right.raw) {
		const length = Math.min(left.raw.length, right.raw.length);
		let index = 0;
		while (index < length && left.raw[index] === right.raw[index]) index++;
		return index;
	}
	if (left.prefix && right.prefix && left.keyId === right.keyId) {
		const length = Math.min(left.prefix.length, right.prefix.length);
		let index = 0;
		while (index < length && left.prefix[index] === right.prefix[index])
			index++;
		return index;
	}
	return null;
}

function firstDifferenceIndex(left: string[], right: string[]): number | null {
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index++) {
		if (left[index] !== right[index]) return index;
	}
	return null;
}

function firstDifference(left: string[], right: string[]) {
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index++) {
		if (left[index] !== right[index])
			return { index, left: left[index], right: right[index] };
	}
	return null;
}

function firstDifferingPath(
	left: PromptAuditArtifact | PromptAuditManifest,
	right: PromptAuditArtifact | PromptAuditManifest,
): string | null {
	if (layerSha(left, 'systemString') !== layerSha(right, 'systemString'))
		return 'system';
	if (
		layerSha(left, 'toolSerialization') !== layerSha(right, 'toolSerialization')
	)
		return 'tools';
	if (layerSha(left, 'messages') !== layerSha(right, 'messages'))
		return 'messages';
	const leftOptions =
		left.kind === 'full'
			? canonicalStringify(left.providerOptions)
			: left.providerOptionsHmac;
	const rightOptions =
		right.kind === 'full'
			? canonicalStringify(right.providerOptions)
			: right.providerOptionsHmac;
	if (leftOptions !== rightOptions) return 'providerOptions';
	return null;
}

function layerSha(
	value: PromptAuditArtifact | PromptAuditManifest,
	name: LayerName,
): string {
	return value.kind === 'full'
		? createHash('sha256').update(value.layers[name]).digest('hex')
		: value.layers[name].sha256;
}

function describeLayer(value: string, key: string): LayerManifest {
	const bytes = Buffer.from(value);
	const prefixHmac64: string[] = [];
	let rolling = '';
	for (const byte of bytes) {
		rolling = createHmac('sha256', key)
			.update(rolling)
			.update(Uint8Array.of(byte))
			.digest('hex');
		prefixHmac64.push(rolling.slice(0, 16));
	}
	return {
		chars: value.length,
		bytes: bytes.length,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		hmacSha256: createHmac('sha256', key).update(bytes).digest('hex'),
		prefixHmac64,
	};
}

function locateRegions(
	system: string,
	segments: PromptAuditArtifact['segments'],
	projectRoot: string,
): PromptAuditArtifact['regions'] {
	const regions = segments.map((segment) => ({
		name: segment.name,
		class: segment.class,
		byteStart: segment.byteStart,
		byteEnd: segment.byteEnd,
		bytes: segment.bytes,
		sha256: segment.sha256,
	}));
	const addMatch = (name: string, start: number, end: number) => {
		if (start < 0 || end <= start) return;
		const content = system.slice(start, end);
		const byteStart = Buffer.byteLength(system.slice(0, start));
		const bytes = Buffer.byteLength(content);
		regions.push({
			name,
			class: 'project-specific',
			byteStart,
			byteEnd: byteStart + bytes,
			bytes,
			sha256: createHash('sha256').update(content).digest('hex'),
		});
	};
	const envStart = system.indexOf('<env>');
	const envEndMarker = system.indexOf('</env>', envStart);
	addMatch(
		'environment:metadata',
		envStart,
		envEndMarker < 0 ? -1 : envEndMarker + 6,
	);
	let instructionStart = system.indexOf('\n--- Custom Instructions from ');
	let instructionOrdinal = 0;
	while (instructionStart >= 0) {
		const next = system.indexOf(
			'\n--- Custom Instructions from ',
			instructionStart + 1,
		);
		const enclosingEnd =
			segments.find((segment) => segment.name === 'environment')?.charEnd ??
			system.length;
		addMatch(
			`instructions:${instructionOrdinal}`,
			instructionStart + 1,
			next < 0 ? enclosingEnd : next,
		);
		instructionOrdinal++;
		instructionStart = next;
	}
	let rootStart = system.indexOf(projectRoot);
	let rootOrdinal = 0;
	while (rootStart >= 0) {
		addMatch(
			`project-root:${rootOrdinal}`,
			rootStart,
			rootStart + projectRoot.length,
		);
		rootOrdinal++;
		rootStart = system.indexOf(projectRoot, rootStart + projectRoot.length);
	}
	return regions.sort(
		(left, right) =>
			left.byteStart - right.byteStart || right.bytes - left.bytes,
	);
}

function locateSegments(
	system: string,
	segments: Array<{ name: string; components: string[]; content: string }>,
): PromptAuditArtifact['segments'] {
	let cursor = 0;
	return segments.map((segment, ordinal) => {
		const charStart = system.indexOf(segment.content, cursor);
		if (charStart < 0) {
			throw new Error(
				`system segment not found in composed prompt: ${segment.name}`,
			);
		}
		const charEnd = charStart + segment.content.length;
		const byteStart = Buffer.byteLength(system.slice(0, charStart));
		const bytes = Buffer.byteLength(segment.content);
		cursor = charEnd;
		return {
			name: segment.name,
			components: segment.components,
			class: classifySegment(segment.name),
			ordinal,
			charStart,
			charEnd,
			byteStart,
			byteEnd: byteStart + bytes,
			chars: segment.content.length,
			bytes,
			sha256: createHash('sha256').update(segment.content).digest('hex'),
		};
	});
}

function classifySegment(name: string): VolatilityClass {
	if (
		name === 'base' ||
		name === 'agent' ||
		name.startsWith('provider:') ||
		name.startsWith('mode:') ||
		name === 'simulator-guidance'
	)
		return 'global-stable';
	if (
		name === 'environment' ||
		name === 'project-tree' ||
		name === 'references' ||
		name.startsWith('skills') ||
		name.startsWith('plugins')
	)
		return 'project-specific';
	if (name === 'user-context' || name === 'context-summary')
		return 'session-specific';
	return 'volatile';
}

function canonicalStringify(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, item]) => item !== undefined && typeof item !== 'function')
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([name, item]) => [name, canonicalize(item)]),
		);
	}
	if (typeof value === 'bigint') return value.toString();
	return value;
}

function hmac(key: string, value: string): string {
	return createHmac('sha256', key).update(value).digest('hex');
}

async function withFrozenTime<T>(
	iso: string,
	action: () => Promise<T>,
): Promise<T> {
	const instant = new Date(iso);
	if (Number.isNaN(instant.getTime()))
		throw new Error(`invalid freeze time: ${iso}`);
	const RealDate = Date;
	class FrozenDate extends RealDate {
		constructor(...args: ConstructorParameters<typeof Date>) {
			super(...(args.length ? args : [instant.getTime()]));
		}
		static now() {
			return instant.getTime();
		}
	}
	globalThis.Date = FrozenDate as DateConstructor;
	try {
		return await action();
	} finally {
		globalThis.Date = RealDate;
	}
}
