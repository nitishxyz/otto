import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { google, createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { createOpenRouterModel } from './openrouter-client.ts';
import { createOpencodeModel } from './opencode-client.ts';
import { createOllama } from 'ai-sdk-ollama';
import type { BuiltInProviderId } from '../../types/src/index.ts';
import { BUILT_IN_PROVIDER_DESCRIPTORS } from '../../types/src/provider-descriptors.ts';
import { createBasetenModel } from './baseten-client.ts';
import { createDeepSeekModel } from './deepseek-client.ts';
import { createHuggingFaceModel } from './huggingface-client.ts';
import { createMetaModel } from './meta-client.ts';
import { createMinimaxModel } from './minimax-client.ts';
import {
	resolveOpenAIResponsesModel,
	shouldUseOpenAIResponsesApi,
} from './model-resolution.ts';
import { normalizeOllamaBaseURL } from './ollama-discovery.ts';
import { createWaferModel } from './wafer-client.ts';
import { createZaiCodingModel, createZaiModel } from './zai-client.ts';

export type BuiltInModelFactoryConfig = {
	apiKey?: string;
	customFetch?: typeof fetch;
	baseURL?: string;
	promptCacheKey?: string;
};

function providerOverrides(config: BuiltInModelFactoryConfig): {
	apiKey?: string;
	baseURL?: string;
	fetch?: typeof fetch;
} {
	return {
		...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
		...(config.baseURL ? { baseURL: config.baseURL } : {}),
		...(config.customFetch ? { fetch: config.customFetch } : {}),
	};
}

const SPECIALIZED_RUNTIME_KINDS = new Set([
	'copilot-oauth',
	'ottorouter',
	'xai-proxy',
	'kimi-oauth',
]);

/** Constructs models for built-in providers that do not require OAuth/proxy state. */
export function createBuiltInProviderModel(
	provider: BuiltInProviderId,
	model: string,
	config: BuiltInModelFactoryConfig = {},
) {
	const descriptor = BUILT_IN_PROVIDER_DESCRIPTORS[provider];
	if (SPECIALIZED_RUNTIME_KINDS.has(descriptor.runtimeKind)) {
		throw new Error(
			`Provider ${provider} requires its specialized runtime adapter.`,
		);
	}

	const overrides = providerOverrides(config);
	const hasOverrides = Object.keys(overrides).length > 0;

	switch (descriptor.runtimeKind) {
		case 'openai': {
			if (!hasOverrides) {
				return shouldUseOpenAIResponsesApi(model)
					? openai.responses(model)
					: openai(model);
			}
			return resolveOpenAIResponsesModel(
				createOpenAI({
					...overrides,
				}),
				model,
			);
		}
		case 'anthropic':
			return hasOverrides
				? createAnthropic(overrides)(model)
				: anthropic(model);
		case 'google':
			return hasOverrides
				? createGoogleGenerativeAI(overrides)(model)
				: google(model);
		case 'meta':
			return createMetaModel(model, {
				apiKey: config.apiKey,
				baseURL: config.baseURL,
				fetch: config.customFetch,
			});
		case 'ollama': {
			const apiKey = config.apiKey || process.env.OLLAMA_API_KEY || '';
			return createOllama({
				baseURL: normalizeOllamaBaseURL(
					config.baseURL || descriptor.defaultBaseURL || 'https://ollama.com',
				),
				headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
				...(config.customFetch ? { fetch: config.customFetch } : {}),
			})(model);
		}
		case 'baseten':
			return createBasetenModel(model, {
				apiKey: config.apiKey,
				baseURL: config.baseURL,
				fetch: config.customFetch,
			});
		case 'huggingface':
			return createHuggingFaceModel(model, {
				apiKey: config.apiKey,
				baseURL: config.baseURL,
				fetch: config.customFetch,
			});
		case 'wafer':
			return createWaferModel(model, {
				apiKey: config.apiKey,
				baseURL: config.baseURL,
				fetch: config.customFetch,
			});
		case 'openrouter':
			return createOpenRouterModel(model, {
				apiKey: config.apiKey,
				baseURL: config.baseURL,
				fetch: config.customFetch,
				promptCacheKey: config.promptCacheKey,
			});
		case 'opencode':
			return createOpencodeModel(model, {
				apiKey: config.apiKey,
				baseURL: config.baseURL,
				fetch: config.customFetch,
				promptCacheKey: config.promptCacheKey,
			});
		case 'zai':
			return createZaiModel(model, {
				apiKey: config.apiKey,
				baseURL: config.baseURL,
				fetch: config.customFetch,
			});
		case 'zai-coding':
			return createZaiCodingModel(model, {
				apiKey: config.apiKey,
				baseURL: config.baseURL,
				fetch: config.customFetch,
			});
		case 'deepseek':
			return createDeepSeekModel(model, {
				apiKey: config.apiKey,
				baseURL: config.baseURL,
				fetch: config.customFetch,
			});
		case 'minimax':
			return createMinimaxModel(model, {
				apiKey: config.apiKey,
				baseURL: config.baseURL,
				fetch: config.customFetch,
			});
		default:
			throw new Error(
				`Unsupported provider runtime: ${descriptor.runtimeKind}`,
			);
	}
}
