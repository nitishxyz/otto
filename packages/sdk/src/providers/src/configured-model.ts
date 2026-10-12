import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOllama } from 'ai-sdk-ollama';
import { resolveOpenAIResponsesModel } from './model-resolution.ts';
import { normalizeOllamaBaseURL } from './ollama-discovery.ts';
import type { ResolvedProviderDefinition } from './registry.ts';
import { getModelProviderCompatibility } from './utils.ts';

export type ConfiguredProviderModelConfig = {
	apiKey?: string;
	customFetch?: typeof fetch;
	reasoningText?: boolean;
};

/** Resolves configured model bindings without reading stored credentials or server state. */
export function createConfiguredProviderModel(
	definition: ResolvedProviderDefinition,
	model: string,
	config: ConfiguredProviderModelConfig = {},
) {
	const apiKey = config.apiKey ?? '';
	const modelInfo = definition.models[model];
	const binding = modelInfo?.provider;
	const compatibility = getModelProviderCompatibility(
		modelInfo,
		definition.compatibility,
	);
	const resolvedModel = binding?.id?.trim() || model;
	const baseURL =
		binding?.baseURL ||
		binding?.api ||
		definition.baseURL ||
		(definition.id === 'ollama-cloud' ? 'https://ollama.com' : undefined);
	if (!baseURL) {
		throw new Error(
			`Custom provider ${definition.id} requires a baseURL in config.`,
		);
	}
	const options = { apiKey, baseURL, fetch: config.customFetch };
	if (compatibility === 'openai') {
		return resolveOpenAIResponsesModel(createOpenAI(options), resolvedModel);
	}
	if (compatibility === 'anthropic')
		return createAnthropic(options)(resolvedModel);
	if (compatibility === 'google')
		return createGoogleGenerativeAI(options)(resolvedModel);
	if (compatibility === 'openrouter')
		return createOpenRouter(options).chat(resolvedModel);
	const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
	if (compatibility === 'ollama') {
		return createOllama({
			baseURL: normalizeOllamaBaseURL(baseURL),
			headers,
			fetch: config.customFetch,
		})(resolvedModel, { ...(config.reasoningText ? { think: true } : {}) });
	}
	return createOpenAICompatible({
		name: definition.label,
		baseURL,
		headers,
		fetch: config.customFetch,
	})(resolvedModel);
}
