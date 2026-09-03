import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { catalog } from './catalog-merged.ts';
import { createAnthropicCachingFetch } from './anthropic-caching.ts';
import { createPromptCacheKeyFetch } from './prompt-caching.ts';
import type { ProviderId } from '../../types/src/index.ts';

export type OpencodeProviderConfig = {
	apiKey?: string;
	promptCacheKey?: string;
	fetch?: typeof fetch;
};

function normalizeModelIdentifier(provider: ProviderId, model: string): string {
	const prefix = `${provider}/`;
	return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

/** Mirrors OpenCode's cache handling for each AI SDK provider binding. */
export function createOpencodeCachingFetch(
	binding: string | undefined,
	config?: OpencodeProviderConfig,
): typeof fetch | undefined {
	if (binding === '@ai-sdk/openai') {
		return createPromptCacheKeyFetch(config?.fetch, config?.promptCacheKey);
	}
	if (binding === '@ai-sdk/anthropic') {
		return createAnthropicCachingFetch(config?.fetch) as typeof fetch;
	}
	return config?.fetch;
}

export function createOpencodeModel(
	model: string,
	config?: OpencodeProviderConfig,
) {
	const entry = catalog.opencode;
	const normalizedModel = normalizeModelIdentifier('opencode', model);
	const modelInfo = entry?.models[normalizedModel] ?? entry?.models[model];
	const resolvedModelId = modelInfo?.id ?? normalizedModel ?? model;
	const binding = modelInfo?.provider?.npm ?? entry?.npm;
	const apiKey = config?.apiKey ?? process.env.OPENCODE_API_KEY ?? '';
	const baseURL =
		modelInfo?.provider?.baseURL ||
		modelInfo?.provider?.api ||
		entry?.api ||
		'https://opencode.ai/zen/v1';
	const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
	const cachingFetch = createOpencodeCachingFetch(binding, config);

	if (binding === '@ai-sdk/openai') {
		const instance = createOpenAI({ apiKey, baseURL, fetch: cachingFetch });
		return instance(resolvedModelId);
	}
	if (binding === '@ai-sdk/anthropic') {
		const instance = createAnthropic({
			apiKey,
			baseURL,
			fetch: cachingFetch,
		});
		return instance(resolvedModelId);
	}
	if (binding === '@ai-sdk/openai-compatible') {
		const instance = createOpenAICompatible({
			name: entry?.label ?? 'opencode',
			baseURL,
			headers,
			fetch: cachingFetch,
		});
		return instance(resolvedModelId);
	}

	const defaultInstance = createOpenAICompatible({
		name: entry?.label ?? 'opencode',
		baseURL,
		headers,
	});
	return defaultInstance(resolvedModelId);
}
