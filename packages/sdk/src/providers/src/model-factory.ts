import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { google, createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOllama } from 'ai-sdk-ollama';
import type { BuiltInProviderId } from '../../types/src/index.ts';
import { BUILT_IN_PROVIDER_DESCRIPTORS } from '../../types/src/provider-descriptors.ts';
import { createBasetenModel } from './baseten-client.ts';
import { catalog } from './catalog-merged.ts';
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
};

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

	switch (descriptor.runtimeKind) {
		case 'openai': {
			if (config.customFetch) {
				const instance = createOpenAI({
					apiKey: config.apiKey || 'oauth-token',
					fetch: config.customFetch,
				});
				return resolveOpenAIResponsesModel(instance, model);
			}
			if (config.apiKey) {
				return resolveOpenAIResponsesModel(
					createOpenAI({ apiKey: config.apiKey }),
					model,
				);
			}
			return shouldUseOpenAIResponsesApi(model)
				? openai.responses(model)
				: openai(model);
		}
		case 'anthropic': {
			if (config.customFetch) {
				return createAnthropic({
					apiKey: config.apiKey || '',
					fetch: config.customFetch,
				});
			}
			if (config.apiKey)
				return createAnthropic({ apiKey: config.apiKey })(model);
			return anthropic(model);
		}
		case 'google':
			return config.apiKey
				? createGoogleGenerativeAI({ apiKey: config.apiKey })(model)
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
			return createOpenRouter({
				apiKey: config.apiKey || process.env.OPENROUTER_API_KEY || '',
			}).chat(model);
		case 'opencode':
			return createOpencodeRuntimeModel(model, config);
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
			});
		default:
			throw new Error(
				`Unsupported provider runtime: ${descriptor.runtimeKind}`,
			);
	}
}

function createOpencodeRuntimeModel(
	model: string,
	config: BuiltInModelFactoryConfig,
) {
	const entry = catalog.opencode;
	const prefix = 'opencode/';
	const normalizedModel = model.startsWith(prefix)
		? model.slice(prefix.length)
		: model;
	const modelInfo = entry?.models[normalizedModel] ?? entry?.models[model];
	const resolvedModelId = modelInfo?.id ?? normalizedModel;
	const binding = modelInfo?.provider?.npm ?? entry?.npm;
	const apiKey = config.apiKey || process.env.OPENCODE_API_KEY || '';
	const baseURL =
		config.baseURL ||
		modelInfo?.provider?.baseURL ||
		modelInfo?.provider?.api ||
		BUILT_IN_PROVIDER_DESCRIPTORS.opencode.defaultBaseURL;
	const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;

	if (binding === '@ai-sdk/openai') {
		return createOpenAI({ apiKey, baseURL })(resolvedModelId);
	}
	if (binding === '@ai-sdk/anthropic') {
		return createAnthropic({ apiKey, baseURL })(resolvedModelId);
	}
	if (binding === '@ai-sdk/openai-compatible') {
		return createOpenAICompatible({
			name: entry?.label ?? 'opencode',
			baseURL,
			headers,
		})(resolvedModelId);
	}

	const id = resolvedModelId.toLowerCase();
	if (id.includes('claude')) {
		return createAnthropic({ apiKey, baseURL })(resolvedModelId);
	}
	if (
		id.includes('qwen3-coder') ||
		id.includes('grok-code') ||
		id.includes('kimi-k2')
	) {
		return createOpenAICompatible({
			name: entry?.label ?? 'opencode',
			baseURL,
			headers,
		})(resolvedModelId);
	}
	return createOpenAI({ apiKey, baseURL })(resolvedModelId);
}
