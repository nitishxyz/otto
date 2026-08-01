import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { OAuth } from '../../types/src/index.ts';
import { catalog } from './catalog-merged.ts';
import { createKimiOAuthFetch } from './kimi-oauth-fetch.ts';
import { readKimiApiKeyFromEnv } from './kimi-env.ts';
import { createPromptCacheKeyFetch } from './prompt-caching.ts';

export { readKimiApiKeyFromEnv } from './kimi-env.ts';

export type KimiProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	oauth?: OAuth;
	projectRoot?: string;
	fetch?: typeof fetch;
	promptCacheKey?: string;
};

const KIMI_CODE_CLI_VERSION = '0.16.0';

type BunFileLike = { text: () => Promise<string> };
type BunLike = {
	file: (path: string) => BunFileLike;
};

let fallbackKimiDeviceId: string | undefined;

function processEnv(): Record<string, string | undefined> | undefined {
	return typeof process !== 'undefined' ? process.env : undefined;
}

function kimiCodeHomeDir(): string | undefined {
	const env = processEnv();
	return (
		env?.KIMI_CODE_HOME || (env?.HOME ? `${env.HOME}/.kimi-code` : undefined)
	);
}

function asciiHeader(value: string, fallback = 'unknown'): string {
	const cleaned = value.replaceAll(/[^\u0020-\u007E]/g, '').trim();
	return cleaned.length > 0 ? cleaned : fallback;
}

function randomDeviceId(): string {
	return (
		globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
	);
}

async function readKimiDeviceId(): Promise<string | null> {
	const home = kimiCodeHomeDir();
	const bun = (globalThis as { Bun?: BunLike }).Bun;
	if (!home || !bun) return null;
	try {
		const existing = (await bun.file(`${home}/device_id`).text()).trim();
		return existing.length > 0 ? existing : null;
	} catch {
		return null;
	}
}

async function readOrCreateKimiDeviceId(): Promise<string> {
	const existing = await readKimiDeviceId();
	if (existing) return existing;
	fallbackKimiDeviceId ??= randomDeviceId();
	return fallbackKimiDeviceId;
}

async function createKimiCodeHeaders(): Promise<Record<string, string>> {
	const env = processEnv();
	const proc = typeof process !== 'undefined' ? process : undefined;
	const platform = env?.OSTYPE ?? env?.OS ?? proc?.platform ?? 'unknown';
	const arch =
		env?.HOSTTYPE ?? env?.PROCESSOR_ARCHITECTURE ?? proc?.arch ?? 'unknown';
	const deviceModel = `${platform} ${arch}`;
	return {
		'User-Agent': `kimi-code-cli/${KIMI_CODE_CLI_VERSION}`,
		'X-Msh-Platform': 'kimi_code_cli',
		'X-Msh-Version': KIMI_CODE_CLI_VERSION,
		'X-Msh-Device-Name': asciiHeader(
			env?.HOSTNAME ?? env?.COMPUTERNAME ?? 'unknown',
		),
		'X-Msh-Device-Model': asciiHeader(deviceModel),
		'X-Msh-Os-Version': asciiHeader(platform),
		'X-Msh-Device-Id': await readOrCreateKimiDeviceId(),
	};
}

function isKimiCodeBaseURL(baseURL: string): boolean {
	return /\/coding\/v1\/?$/.test(baseURL);
}

const KIMI_UNSUPPORTED_SCHEMA_KEYS = new Set([
	'$schema',
	'$id',
	'$ref',
	'$defs',
	'definitions',
	'examples',
	'title',
	'nullable',
	'format',
	'pattern',
	'minLength',
	'maxLength',
	'minimum',
	'maximum',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'multipleOf',
	'minItems',
	'maxItems',
	'uniqueItems',
	'contains',
	'minContains',
	'maxContains',
	'prefixItems',
	'propertyNames',
	'patternProperties',
	'allOf',
	'not',
	'if',
	'then',
	'else',
	'dependentSchemas',
	'dependentRequired',
	'unevaluatedProperties',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Converts AI SDK JSON Schema output into the smaller schema dialect accepted
 * by Kimi tool calls.
 */
export function sanitizeKimiToolSchema(schema: unknown): unknown {
	if (Array.isArray(schema))
		return schema.map((item) => sanitizeKimiToolSchema(item));
	if (!isRecord(schema)) return schema;

	const out: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(schema)) {
		if (key === 'const') {
			if (['number', 'string'].includes(typeof value)) out.enum = [value];
			continue;
		}
		if (key === 'oneOf') {
			const branches = toArray(value);
			if (branches.length > 0) out.anyOf = sanitizeKimiToolSchema(branches);
			continue;
		}
		if (key === 'properties' && isRecord(value)) {
			out.properties = Object.fromEntries(
				Object.entries(value).map(([propertyName, propertySchema]) => [
					propertyName,
					sanitizeKimiToolSchema(propertySchema),
				]),
			);
			continue;
		}
		if (KIMI_UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
		if (key === 'type' && Array.isArray(value)) {
			const types = value.filter(
				(type): type is string => typeof type === 'string',
			);
			if (types.length === 1) out.type = types[0];
			else if (types.length > 1) {
				out.anyOf = types.map((type) => ({ type }));
			}
			continue;
		}
		if (key === 'enum' && Array.isArray(value)) {
			out.enum = value.filter((item) => item !== null);
			continue;
		}
		out[key] = sanitizeKimiToolSchema(value);
	}

	return out;
}

function toArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function sanitizeKimiToolRequest(body: unknown): unknown {
	if (!isRecord(body) || !Array.isArray(body.tools)) return body;
	let changed = false;
	const tools = body.tools.map((tool) => {
		if (!isRecord(tool)) return tool;
		const fn = tool.function;
		if (!isRecord(fn) || !('parameters' in fn)) return tool;
		changed = true;
		return {
			...tool,
			function: {
				...fn,
				parameters: sanitizeKimiToolSchema(fn.parameters),
			},
		};
	});
	return changed ? { ...body, tools } : body;
}

function sanitizeKimiFetchInit(init?: RequestInit): RequestInit | undefined {
	if (!init || typeof init.body !== 'string') return init;
	try {
		const parsed = JSON.parse(init.body) as unknown;
		const sanitized = sanitizeKimiToolRequest(parsed);
		if (sanitized === parsed) return init;
		return { ...init, body: JSON.stringify(sanitized) };
	} catch {
		return init;
	}
}

function normalizeKimiCodeFetchInit(
	init?: RequestInit,
): RequestInit | undefined {
	if (!init?.headers) return init;
	const headers = new Headers(init.headers);
	if (headers.get('x-msh-platform') !== 'kimi_code_cli') return init;
	headers.set('User-Agent', `kimi-code-cli/${KIMI_CODE_CLI_VERSION}`);
	return { ...init, headers };
}

async function withKimiCodeHeaders(
	init?: RequestInit,
	enabled = false,
): Promise<RequestInit | undefined> {
	if (!enabled) return normalizeKimiCodeFetchInit(init);
	const headers = new Headers(init?.headers);
	const kimiHeaders = await createKimiCodeHeaders();
	for (const [key, value] of Object.entries(kimiHeaders)) {
		headers.set(key, value);
	}
	return normalizeKimiCodeFetchInit({ ...init, headers });
}

/**
 * Kimi streaming responses report token usage on the final chunk's
 * `choices[0].usage` instead of the OpenAI-standard top-level `usage` field.
 * The AI SDK openai-compatible parser only reads top-level `usage`, so we
 * hoist choice-level usage to the top level when it is missing.
 */
export function hoistKimiSseUsage(line: string): string {
	const hasCarriageReturn = line.endsWith('\r');
	const raw = hasCarriageReturn ? line.slice(0, -1) : line;
	if (!raw.startsWith('data:')) return line;
	const payload = raw.slice(5).trim();
	if (!payload || payload === '[DONE]') return line;
	try {
		const parsed = JSON.parse(payload) as {
			usage?: unknown;
			choices?: Array<{ usage?: unknown } | null>;
		};
		if (!parsed || typeof parsed !== 'object') return line;
		let changed = false;
		if (parsed.usage == null) {
			const choiceUsage = Array.isArray(parsed.choices)
				? parsed.choices.find((choice) => choice?.usage != null)?.usage
				: undefined;
			if (choiceUsage != null) {
				parsed.usage = choiceUsage;
				changed = true;
			}
		}
		if (normalizeKimiCachedTokens(parsed.usage)) changed = true;
		return changed
			? `data: ${JSON.stringify(parsed)}${hasCarriageReturn ? '\r' : ''}`
			: line;
	} catch {
		return line;
	}
}

function normalizeKimiCachedTokens(usage: unknown): boolean {
	if (!isRecord(usage) || typeof usage.cached_tokens !== 'number') return false;
	const details = isRecord(usage.prompt_tokens_details)
		? usage.prompt_tokens_details
		: {};
	if (typeof details.cached_tokens === 'number') return false;
	usage.prompt_tokens_details = {
		...details,
		cached_tokens: usage.cached_tokens,
	};
	return true;
}

async function normalizeKimiJsonUsage(response: Response): Promise<Response> {
	try {
		const parsed = (await response.clone().json()) as unknown;
		if (!isRecord(parsed) || !normalizeKimiCachedTokens(parsed.usage)) {
			return response;
		}
		const headers = new Headers(response.headers);
		headers.delete('content-length');
		headers.delete('content-encoding');
		return new Response(JSON.stringify(parsed), {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	} catch {
		return response;
	}
}

/**
 * Wraps fetch so Kimi SSE chunks carrying `choices[0].usage` are rewritten to
 * expose a top-level `usage` field the AI SDK can parse.
 */
export function createKimiUsageFetch(
	baseFetch: typeof fetch = fetch,
	injectKimiCodeHeaders = false,
): typeof fetch {
	const wrappedFetch = async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	): Promise<Response> => {
		const response = await baseFetch(
			input,
			await withKimiCodeHeaders(
				sanitizeKimiFetchInit(init),
				injectKimiCodeHeaders,
			),
		);
		const contentType = response.headers.get('content-type') ?? '';
		if (
			!response.ok ||
			!response.body ||
			!contentType.includes('text/event-stream')
		) {
			return response.ok && contentType.includes('application/json')
				? normalizeKimiJsonUsage(response)
				: response;
		}

		const decoder = new TextDecoder();
		const encoder = new TextEncoder();
		let buffered = '';
		const transform = new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				buffered += decoder.decode(chunk, { stream: true });
				const lines = buffered.split('\n');
				buffered = lines.pop() ?? '';
				for (const line of lines) {
					controller.enqueue(encoder.encode(`${hoistKimiSseUsage(line)}\n`));
				}
			},
			flush(controller) {
				buffered += decoder.decode();
				if (buffered.length) {
					controller.enqueue(encoder.encode(hoistKimiSseUsage(buffered)));
				}
			},
		});

		const headers = new Headers(response.headers);
		headers.delete('content-length');
		headers.delete('content-encoding');
		return new Response(response.body.pipeThrough(transform), {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	};
	return wrappedFetch as typeof fetch;
}

export function createKimiModel(model: string, config?: KimiProviderConfig) {
	const entry = catalog.kimi;
	const oauthAccess = config?.oauth?.access;
	const defaultApiBaseURL = entry?.api ?? 'https://api.moonshot.ai/v1';
	const configuredBaseURL = config?.baseURL;
	const kimiCodeBaseURL =
		process.env.KIMI_CODE_BASE_URL ?? 'https://api.kimi.com/coding/v1';
	const baseURL =
		oauthAccess &&
		(!configuredBaseURL || configuredBaseURL === defaultApiBaseURL)
			? kimiCodeBaseURL
			: (configuredBaseURL ?? defaultApiBaseURL);
	const apiKey = oauthAccess || config?.apiKey || readKimiApiKeyFromEnv();
	const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
	const requestFetch = config?.oauth
		? createKimiOAuthFetch(config.oauth, config.projectRoot, config.fetch)
		: config?.fetch;
	const cacheAwareFetch = createPromptCacheKeyFetch(
		requestFetch,
		config?.promptCacheKey,
	);

	const instance = createOpenAICompatible({
		name: 'Kimi',
		baseURL,
		headers,
		fetch: createKimiUsageFetch(cacheAwareFetch, isKimiCodeBaseURL(baseURL)),
	});

	return instance(model);
}
