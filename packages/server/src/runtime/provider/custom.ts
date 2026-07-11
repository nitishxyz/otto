import {
	getConfiguredProviderApiKey,
	normalizeOllamaBaseURL,
	resolveOpenAIResponsesModel,
	type getProviderDefinition,
	type OttoConfig,
} from '@ottocode/sdk';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOllama } from 'ai-sdk-ollama';
import { providerFetch } from './fetch.ts';

export function resolveCustomConfiguredModel(
	definition: NonNullable<ReturnType<typeof getProviderDefinition>>,
	cfg: OttoConfig,
	model: string,
	options?: {
		reasoningText?: boolean;
	},
) {
	const apiKey = getConfiguredProviderApiKey(cfg, definition.id) || '';
	const baseURL =
		definition.baseURL ||
		(definition.id === 'ollama-cloud' ? 'https://ollama.com' : undefined);

	if (!baseURL) {
		throw new Error(
			`Custom provider ${definition.id} requires a baseURL in config.`,
		);
	}

	if (definition.compatibility === 'openai') {
		const instance = createOpenAI({ apiKey, baseURL, fetch: providerFetch });
		return resolveOpenAIResponsesModel(instance, model);
	}

	if (definition.compatibility === 'anthropic') {
		const instance = createAnthropic({ apiKey, baseURL, fetch: providerFetch });
		return instance(model);
	}

	if (definition.compatibility === 'google') {
		const instance = createGoogleGenerativeAI({
			apiKey,
			baseURL,
			fetch: providerFetch,
		});
		return instance(model);
	}

	if (definition.compatibility === 'openrouter') {
		const instance = createOpenRouter({
			apiKey,
			baseURL,
			fetch: providerFetch,
		});
		return instance.chat(model);
	}

	if (definition.compatibility === 'ollama') {
		const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
		const ollamaBaseURL = normalizeOllamaBaseURL(baseURL);
		const instance = createOllama({
			baseURL: ollamaBaseURL,
			headers,
			fetch: providerFetch,
		});
		return instance(model, {
			...(options?.reasoningText ? { think: true } : {}),
		});
	}

	const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
	const instance = createOpenAICompatible({
		name: definition.label,
		baseURL,
		headers,
		fetch: providerFetch,
	});
	return instance(model);
}
