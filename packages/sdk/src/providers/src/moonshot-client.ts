import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { OAuth } from '../../types/src/index.ts';
import { catalog } from './catalog-merged.ts';

export type KimiProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	oauth?: OAuth;
};

/** @deprecated Use `KimiProviderConfig` */
export type MoonshotProviderConfig = KimiProviderConfig;

export function readKimiApiKeyFromEnv(): string {
	return process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || '';
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
 * by Kimi/Moonshot tool calls.
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

/**
 * Kimi/Moonshot streaming responses report token usage on the final chunk's
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
		if (!parsed || typeof parsed !== 'object' || parsed.usage != null) {
			return line;
		}
		const choiceUsage = Array.isArray(parsed.choices)
			? parsed.choices.find((choice) => choice?.usage != null)?.usage
			: undefined;
		if (choiceUsage == null) return line;
		parsed.usage = choiceUsage;
		return `data: ${JSON.stringify(parsed)}${hasCarriageReturn ? '\r' : ''}`;
	} catch {
		return line;
	}
}

/**
 * Wraps fetch so Kimi SSE chunks carrying `choices[0].usage` are rewritten to
 * expose a top-level `usage` field the AI SDK can parse.
 */
export function createKimiUsageFetch(
	baseFetch: typeof fetch = fetch,
): typeof fetch {
	const wrappedFetch = async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	): Promise<Response> => {
		const response = await baseFetch(input, sanitizeKimiFetchInit(init));
		const contentType = response.headers.get('content-type') ?? '';
		if (
			!response.ok ||
			!response.body ||
			!contentType.includes('text/event-stream')
		) {
			return response;
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
	const entry = catalog.moonshot;
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

	const instance = createOpenAICompatible({
		name: 'Kimi',
		baseURL,
		headers,
		fetch: createKimiUsageFetch(),
	});

	return instance(model);
}

/** @deprecated Use `createKimiModel` */
export function createMoonshotModel(
	model: string,
	config?: MoonshotProviderConfig,
) {
	return createKimiModel(model, config);
}
