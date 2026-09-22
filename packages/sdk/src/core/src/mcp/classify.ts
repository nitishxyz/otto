import { createHash } from 'node:crypto';
import { getOttoHomeDir, joinPath } from '../../../config/src/paths.ts';
import { choice, noul, type JudgeClient } from '../../../judge/index.ts';
import type { PluginToolEffect } from '../../../plugins/index.ts';
import {
	atomicWriteJsonObject,
	readOptionalJsonObject,
} from '../../../runtime/json-object-file.ts';
import type { MCPToolInfo } from './client.ts';

/** Coarse effect class for an MCP tool. Ordered from safest to riskiest. */
export type MCPToolEffectClass =
	| 'read_only'
	| 'local_write'
	| 'external_write'
	| 'destructive';

export type MCPToolClassification = {
	effect: MCPToolEffectClass;
	/** Probability that the effect cannot be easily undone. */
	irreversible: number;
	/** Distribution concentration for `effect` (0-1). */
	confidence: number;
	source: 'annotations' | 'judge';
	model?: string;
	classifiedAt: number;
};

export type MCPToolClassificationInput = {
	name: string;
	server: string;
	tool: MCPToolInfo;
};

const CACHE_VERSION = 1;
const MIN_CONFIDENCE = 0.55;
const IRREVERSIBLE_THRESHOLD = 0.6;
const BATCH_SIZE = 25;

type CacheFile = {
	version: number;
	entries: Record<string, MCPToolClassification>;
};

export function getMCPClassificationCachePath(): string {
	return joinPath(getOttoHomeDir(), 'cache', 'mcp-tool-classifications.json');
}

/** Stable key: changes whenever the tool's contract changes. */
export function mcpToolClassificationKey(
	input: MCPToolClassificationInput,
): string {
	const hash = createHash('sha256')
		.update(
			JSON.stringify({
				name: input.tool.name,
				description: input.tool.description ?? '',
				inputSchema: input.tool.inputSchema,
				annotations: input.tool.annotations ?? null,
			}),
		)
		.digest('hex')
		.slice(0, 24);
	return `${input.server}::${input.tool.name}::${hash}`;
}

/** Map a classification to the plugin effect vocabulary used by approval gating. */
export function classificationToEffects(
	classification: MCPToolClassification,
): PluginToolEffect[] {
	switch (classification.effect) {
		case 'read_only':
			return ['workspace-read'];
		case 'local_write':
			return ['workspace-write'];
		case 'external_write':
		case 'destructive':
			return ['external-write'];
	}
}

/** Derive a classification purely from MCP annotations, when the server provides them. */
export function classifyFromAnnotations(
	tool: MCPToolInfo,
): MCPToolClassification | undefined {
	const annotations = tool.annotations;
	if (!annotations) return undefined;
	const { readOnlyHint, destructiveHint } = annotations;
	if (readOnlyHint === true) {
		return {
			effect: 'read_only',
			irreversible: 0,
			confidence: 1,
			source: 'annotations',
			classifiedAt: Date.now(),
		};
	}
	if (destructiveHint === true) {
		return {
			effect: 'destructive',
			irreversible: 1,
			confidence: 1,
			source: 'annotations',
			classifiedAt: Date.now(),
		};
	}
	if (destructiveHint === false && readOnlyHint === false) {
		return {
			effect: 'external_write',
			irreversible: 0.2,
			confidence: 1,
			source: 'annotations',
			classifiedAt: Date.now(),
		};
	}
	return undefined;
}

function buildQuestions(inputs: MCPToolClassificationInput[]) {
	const questions: Record<
		string,
		ReturnType<typeof choice<MCPToolEffectClass>> | ReturnType<typeof noul>
	> = {};
	for (let index = 0; index < inputs.length; index++) {
		const path = `tools[${index}]`;
		questions[`effect_${index}`] = choice<MCPToolEffectClass>(
			`Considering only the tool described at \`${path}\` (its name, description, and input schema), what does invoking it do?`,
			{
				read_only:
					'Reads, lists, searches, or fetches information. Changes nothing.',
				local_write:
					'Creates or modifies files or state on the local machine or workspace only.',
				external_write:
					'Creates, updates, sends, or posts data in an external system (APIs, SaaS, databases, messages, emails, tickets).',
				destructive:
					'Deletes, drops, force-overwrites, revokes, or otherwise removes data or access in a way that is hard to recover.',
			},
		);
		questions[`irreversible_${index}`] = noul(
			`Considering only the tool at \`${path}\`, would a mistaken invocation be hard to undo?`,
			{
				true: 'Effects are permanent or require significant effort to reverse.',
				false: 'Nothing changes, or the change can be trivially reverted.',
			},
		);
	}
	return questions;
}

function toState(inputs: MCPToolClassificationInput[]) {
	return {
		tools: inputs.map((input) => ({
			server: input.server,
			name: input.tool.name,
			description: input.tool.description ?? '',
			inputSchema: input.tool.inputSchema,
		})),
	};
}

async function judgeBatch(
	judge: JudgeClient,
	inputs: MCPToolClassificationInput[],
	signal?: AbortSignal,
): Promise<Map<string, MCPToolClassification>> {
	const out = new Map<string, MCPToolClassification>();
	if (inputs.length === 0) return out;
	const questions = buildQuestions(inputs);
	const result = await judge.judge({
		state: toState(inputs),
		questions,
		signal,
	});
	if (!result.ok) return out;
	inputs.forEach((input, index) => {
		const effectAnswer = result.answers[`effect_${index}`];
		const irreversibleAnswer = result.answers[`irreversible_${index}`];
		if (
			!effectAnswer ||
			effectAnswer.type !== 'choice' ||
			!irreversibleAnswer ||
			irreversibleAnswer.type !== 'noul'
		) {
			return;
		}
		let effect = effectAnswer.choice as MCPToolEffectClass;
		// Policy lives here, not in the model: uncertain or likely-irreversible
		// writes are escalated so the approval prompt errs on asking.
		if (effectAnswer.confidence < MIN_CONFIDENCE && effect !== 'read_only') {
			effect = 'external_write';
		}
		if (
			irreversibleAnswer.noul >= IRREVERSIBLE_THRESHOLD &&
			effect !== 'read_only'
		) {
			effect = 'destructive';
		}
		out.set(input.name, {
			effect,
			irreversible: irreversibleAnswer.noul,
			confidence: effectAnswer.confidence,
			source: 'judge',
			model: result.model,
			classifiedAt: Date.now(),
		});
	});
	return out;
}

async function readCache(path: string): Promise<CacheFile> {
	const raw = await readOptionalJsonObject(path);
	if (
		raw &&
		raw.version === CACHE_VERSION &&
		raw.entries &&
		typeof raw.entries === 'object'
	) {
		return raw as CacheFile;
	}
	return { version: CACHE_VERSION, entries: {} };
}

export type ClassifyMCPToolsOptions = {
	judge: JudgeClient | null;
	cachePath?: string;
	signal?: AbortSignal;
};

/**
 * Classify MCP tools by effect. Resolution order per tool: disk cache,
 * server-provided annotations, judge. Tools that cannot be classified are
 * omitted so callers keep their existing behavior for them.
 */
export async function classifyMCPTools(
	inputs: MCPToolClassificationInput[],
	options: ClassifyMCPToolsOptions,
): Promise<Map<string, MCPToolClassification>> {
	const results = new Map<string, MCPToolClassification>();
	if (inputs.length === 0) return results;

	const cachePath = options.cachePath ?? getMCPClassificationCachePath();
	const cache = await readCache(cachePath);
	const keys = new Map<string, string>();
	const pending: MCPToolClassificationInput[] = [];
	let dirty = false;

	for (const input of inputs) {
		const key = mcpToolClassificationKey(input);
		keys.set(input.name, key);
		const cached = cache.entries[key];
		if (cached) {
			results.set(input.name, cached);
			continue;
		}
		const fromAnnotations = classifyFromAnnotations(input.tool);
		if (fromAnnotations) {
			results.set(input.name, fromAnnotations);
			cache.entries[key] = fromAnnotations;
			dirty = true;
			continue;
		}
		pending.push(input);
	}

	if (options.judge && pending.length > 0) {
		for (let i = 0; i < pending.length; i += BATCH_SIZE) {
			const batch = pending.slice(i, i + BATCH_SIZE);
			const judged = await judgeBatch(options.judge, batch, options.signal);
			for (const [name, classification] of judged) {
				results.set(name, classification);
				const key = keys.get(name);
				if (key) {
					cache.entries[key] = classification;
					dirty = true;
				}
			}
		}
	}

	if (dirty) {
		await atomicWriteJsonObject(cachePath, cache).catch(() => {});
	}
	return results;
}
