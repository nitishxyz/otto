import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createXai } from '@ai-sdk/xai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { wrapLanguageModel } from 'ai';
import type { LanguageModelV3Middleware } from '@ai-sdk/provider';
import type { ProviderApiFormat, ProviderId, FetchFunction } from '../types.ts';
import { createOttoRouterOpenRouterFetch } from '../fetch.ts';

export function createModel(
	modelId: string,
	apiFormat: ProviderApiFormat,
	providerId: ProviderId,
	baseURL: string,
	customFetch: FetchFunction,
	middleware?: LanguageModelV3Middleware | LanguageModelV3Middleware[],
) {
	const applyMiddleware = <TModel>(model: TModel) => {
		if (middleware) {
			return wrapLanguageModel({ model: model as never, middleware });
		}

		return model;
	};

	switch (apiFormat) {
		case 'anthropic-messages': {
			const provider = createAnthropic({
				baseURL,
				apiKey: 'ottorouter-wallet-auth',
				fetch: customFetch as unknown as typeof globalThis.fetch,
			});
			return applyMiddleware(provider(modelId));
		}

		case 'google-native': {
			const provider = createGoogleGenerativeAI({
				baseURL,
				apiKey: 'ottorouter-wallet-auth',
				fetch: customFetch as unknown as typeof globalThis.fetch,
			});
			return applyMiddleware(provider(modelId));
		}

		case 'openrouter-chat': {
			const provider = createOpenRouter({
				baseURL,
				apiKey: 'ottorouter-wallet-auth',
				compatibility: 'strict',
				fetch: createOttoRouterOpenRouterFetch(
					customFetch,
				) as unknown as typeof globalThis.fetch,
			});
			return applyMiddleware(provider.chat(`openrouter/${modelId}`));
		}

		case 'xai-chat': {
			const provider = createXai({
				baseURL,
				apiKey: 'ottorouter-wallet-auth',
				fetch: customFetch as unknown as typeof globalThis.fetch,
			});
			return applyMiddleware(provider(modelId));
		}

		case 'openai-chat': {
			const provider = createOpenAICompatible({
				name: `ottorouter-${providerId}`,
				baseURL,
				headers: { Authorization: 'Bearer ottorouter-wallet-auth' },
				fetch: customFetch as unknown as typeof globalThis.fetch,
			});
			return applyMiddleware(provider(modelId));
		}
		default: {
			const provider = createOpenAI({
				baseURL,
				apiKey: 'ottorouter-wallet-auth',
				fetch: customFetch as unknown as typeof globalThis.fetch,
			});
			return applyMiddleware(provider.responses(modelId));
		}
	}
}
