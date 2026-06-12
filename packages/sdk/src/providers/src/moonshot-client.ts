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
		const response = await baseFetch(input, init);
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
