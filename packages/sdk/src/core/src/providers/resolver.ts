import { openai, createOpenAI } from '@ai-sdk/openai';
import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { google, createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ai-sdk-ollama';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
	catalog,
	createMinimaxModel,
	createMoonshotModel,
	createOttoRouterModel,
	createOpenAIOAuthModel,
	createXaiModel,
	createZaiCodingModel,
	createZaiModel,
	normalizeOllamaBaseURL,
	resolveOpenAIResponsesModel,
	shouldUseOpenAIResponsesApi,
} from '../../../providers/src/index.ts';
import { createCopilotModel } from '../../../providers/src/copilot-client.ts';
import type { OAuth } from '../../../types/src/index.ts';

export type ProviderName =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'ollama-cloud'
	| 'openrouter'
	| 'opencode'
	| 'copilot'
	| 'ottorouter'
	| 'xai'
	| 'zai'
	| 'zai-coding'
	| 'moonshot'
	| 'minimax';

export type ModelConfig = {
	apiKey?: string;
	customFetch?: typeof fetch;
	baseURL?: string;
	oauth?: OAuth;
	projectRoot?: string;
};

export async function resolveModel(
	provider: ProviderName,
	model: string,
	config: ModelConfig = {},
) {
	if (provider === 'openai') {
		if (config.oauth) {
			return createOpenAIOAuthModel(model, {
				oauth: config.oauth,
				projectRoot: config.projectRoot,
			});
		}
		if (config.customFetch) {
			const instance = createOpenAI({
				apiKey: config.apiKey || 'oauth-token',
				fetch: config.customFetch,
			});
			return resolveOpenAIResponsesModel(instance, model);
		}
		if (config.apiKey) {
			const instance = createOpenAI({ apiKey: config.apiKey });
			return resolveOpenAIResponsesModel(instance, model);
		}
		return shouldUseOpenAIResponsesApi(model)
			? openai.responses(model)
			: openai(model);
	}

	if (provider === 'anthropic') {
		if (config.customFetch) {
			return createAnthropic({
				apiKey: config.apiKey || '',
				fetch: config.customFetch as typeof fetch,
			});
		}
		if (config.apiKey) {
			const instance = createAnthropic({ apiKey: config.apiKey });
			return instance(model);
		}
		return anthropic(model);
	}

	if (provider === 'google') {
		if (config.apiKey) {
			const instance = createGoogleGenerativeAI({ apiKey: config.apiKey });
			return instance(model);
		}
		return google(model);
	}

	if (provider === 'ollama-cloud') {
		const entry = catalog[provider];
		const apiKey = config.apiKey || process.env.OLLAMA_API_KEY || '';
		const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
		const baseURL = normalizeOllamaBaseURL(
			config.baseURL || entry?.api || 'https://ollama.com',
		);
		const instance = createOllama({
			baseURL,
			headers,
		});
		return instance(model);
	}

	if (provider === 'openrouter') {
		const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || '';
		const openrouter = createOpenRouter({ apiKey });
		return openrouter.chat(model);
	}

	if (provider === 'opencode') {
		const entry = catalog[provider];
		const normalizedModel = normalizeModelIdentifier(provider, model);
		const modelInfo =
			entry?.models.find((m) => m.id === normalizedModel) ??
			entry?.models.find((m) => m.id === model);
		const resolvedModelId = modelInfo?.id ?? normalizedModel ?? model;
		const binding = modelInfo?.provider?.npm ?? entry?.npm;
		const apiKey = config.apiKey || process.env.OPENCODE_API_KEY || '';
		const baseURL =
			config.baseURL ||
			modelInfo?.provider?.baseURL ||
			modelInfo?.provider?.api ||
			entry?.api ||
			'https://opencode.ai/zen/v1';
		const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
		if (binding === '@ai-sdk/openai') {
			const instance = createOpenAI({ apiKey, baseURL });
			return instance(resolvedModelId);
		}
		if (binding === '@ai-sdk/anthropic') {
			const instance = createAnthropic({ apiKey, baseURL });
			return instance(resolvedModelId);
		}
		if (binding === '@ai-sdk/openai-compatible') {
			const instance = createOpenAICompatible({
				name: entry?.label ?? 'opencode',
				baseURL,
				headers,
			});
			return instance(resolvedModelId);
		}

		const ocOpenAI = createOpenAI({ apiKey, baseURL });
		const ocAnthropic = createAnthropic({ apiKey, baseURL });
		const ocCompat = createOpenAICompatible({
			name: entry?.label ?? 'opencode',
			baseURL,
			headers,
		});

		const id = resolvedModelId.toLowerCase();
		if (id.includes('claude')) return ocAnthropic(resolvedModelId);
		if (
			id.includes('qwen3-coder') ||
			id.includes('grok-code') ||
			id.includes('kimi-k2')
		)
			return ocCompat(resolvedModelId);
		return ocOpenAI(resolvedModelId);
	}

	if (provider === 'copilot') {
		if (config.oauth) {
			return createCopilotModel(model, { oauth: config.oauth });
		}
		throw new Error(
			'Copilot provider requires OAuth. Run `otto auth login copilot`.',
		);
	}

	if (provider === 'ottorouter') {
		const privateKey =
			config.apiKey || process.env.OTTOROUTER_PRIVATE_KEY || '';
		if (!privateKey) {
			throw new Error(
				'OttoRouter provider requires OTTOROUTER_PRIVATE_KEY (base58 Solana secret).',
			);
		}
		const baseURL = config.baseURL || process.env.OTTOROUTER_BASE_URL;
		const rpcURL = process.env.OTTOROUTER_SOLANA_RPC_URL;
		return createOttoRouterModel(
			model,
			{ privateKey },
			{
				baseURL,
				rpcURL,
			},
		);
	}

	if (provider === 'xai') {
		return createXaiModel(model, {
			apiKey: config.apiKey,
			baseURL: config.baseURL,
		});
	}

	if (provider === 'zai') {
		return createZaiModel(model, {
			apiKey: config.apiKey,
			baseURL: config.baseURL,
		});
	}

	if (provider === 'zai-coding') {
		return createZaiCodingModel(model, {
			apiKey: config.apiKey,
			baseURL: config.baseURL,
		});
	}

	if (provider === 'moonshot') {
		return createMoonshotModel(model, {
			apiKey: config.apiKey,
			baseURL: config.baseURL,
		});
	}

	if (provider === 'minimax') {
		return createMinimaxModel(model, {
			apiKey: config.apiKey,
			baseURL: config.baseURL,
		});
	}

	throw new Error(`Unsupported provider: ${provider}`);
}

function normalizeModelIdentifier(
	provider: ProviderName,
	model: string,
): string {
	const prefix = `${provider}/`;
	return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}
