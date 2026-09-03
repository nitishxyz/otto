import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createConditionalCachingFetch } from './anthropic-caching.ts';
import { createPromptCacheKeyFetch } from './prompt-caching.ts';
import { getModelNpmBinding } from './utils.ts';

export type OpenRouterProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	fetch?: typeof fetch;
	promptCacheKey?: string;
};

function isAnthropicModel(model: string): boolean {
	const npm = getModelNpmBinding('openrouter', model);
	return npm === '@ai-sdk/anthropic';
}

/** Adds OpenRouter stickiness plus the upstream prompt cache affinity hint. */
export function createOpenRouterCachingFetch(
	baseFetch: typeof fetch = fetch,
	promptCacheKey?: string,
): typeof fetch {
	const promptCachingFetch = createPromptCacheKeyFetch(
		baseFetch,
		promptCacheKey,
	);
	if (!promptCacheKey) return promptCachingFetch;

	const cachingFetch = async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	): Promise<Response> => {
		if (typeof init?.body !== 'string') {
			return promptCachingFetch(input, init);
		}

		try {
			const parsed = JSON.parse(init.body) as unknown;
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return promptCachingFetch(input, init);
			}
			const body = parsed as Record<string, unknown>;
			if (typeof body.session_id !== 'string') {
				body.session_id = promptCacheKey;
			}
			return promptCachingFetch(input, {
				...init,
				body: JSON.stringify(body),
			});
		} catch {
			return promptCachingFetch(input, init);
		}
	};

	return Object.assign(cachingFetch, { preconnect: baseFetch.preconnect });
}

export function getOpenRouterInstance(
	model?: string,
	config?: OpenRouterProviderConfig,
) {
	const apiKey = config?.apiKey ?? process.env.OPENROUTER_API_KEY ?? '';
	const cachingFetch = model
		? createConditionalCachingFetch(isAnthropicModel, model, config?.fetch)
		: config?.fetch;
	const customFetch = createOpenRouterCachingFetch(
		cachingFetch,
		config?.promptCacheKey,
	);
	return createOpenRouter({
		apiKey,
		fetch: customFetch,
	});
}

export function createOpenRouterModel(
	model: string,
	config?: OpenRouterProviderConfig,
) {
	const openrouter = getOpenRouterInstance(model, config);
	return openrouter.chat(model);
}
