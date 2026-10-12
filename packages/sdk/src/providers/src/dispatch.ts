import type { BuiltInProviderId, OAuth } from '../../types/src/index.ts';
import {
	createAnthropicOAuthModel,
	type AnthropicOAuthConfig,
} from './anthropic-oauth-client.ts';
import { createAnthropicCachingFetch } from './anthropic-caching.ts';
import { createCopilotModel } from './copilot-client.ts';
import { createKimiModel } from './kimi-client.ts';
import {
	createBuiltInProviderModel,
	type BuiltInModelFactoryConfig,
} from './model-factory.ts';
import { createOpenAIOAuthModel } from './openai-oauth-client.ts';
import {
	createOttoRouterModel,
	type OttoRouterAuth,
	type OttoRouterProviderOptions,
} from './ottorouter-client.ts';
import { createPromptCacheKeyFetch } from './prompt-caching.ts';
import { createXaiModel, isXaiGrokCliModel } from './xai-client.ts';

export type ProviderModelConfig = BuiltInModelFactoryConfig & {
	oauth?: OAuth;
	projectRoot?: string;
	authMode?: AnthropicOAuthConfig['authMode'];
	toolNameTransformer?: AnthropicOAuthConfig['toolNameTransformer'];
	sessionId?: string;
	ottorouterAuth?: OttoRouterAuth;
	ottorouterOptions?: OttoRouterProviderOptions;
};

/** Constructs a model from normalized credentials; callers own auth selection and server policy. */
export function createProviderModel(
	provider: BuiltInProviderId,
	model: string,
	config: ProviderModelConfig = {},
) {
	if (provider === 'anthropic' && config.oauth) {
		return createAnthropicOAuthModel(model, {
			oauth: config.oauth,
			projectRoot: config.projectRoot,
			authMode: config.authMode,
			toolNameTransformer: config.toolNameTransformer,
			fetch: config.customFetch,
		});
	}
	if (provider === 'openai' && config.oauth) {
		return createOpenAIOAuthModel(model, {
			oauth: config.oauth,
			projectRoot: config.projectRoot,
			sessionId: config.sessionId,
			fetch: config.customFetch,
		});
	}
	if (provider === 'copilot') {
		if (!config.oauth) {
			throw new Error(
				'Copilot provider requires OAuth. Run `otto auth login copilot`.',
			);
		}
		return createCopilotModel(model, {
			oauth: config.oauth,
			fetch: config.customFetch,
		});
	}
	if (provider === 'ottorouter') {
		if (!config.ottorouterAuth) {
			throw new Error(
				'OttoRouter provider requires OAuth. Run `otto auth login ottorouter`.',
			);
		}
		return createOttoRouterModel(model, config.ottorouterAuth, {
			...config.ottorouterOptions,
			baseURL: config.baseURL ?? config.ottorouterOptions?.baseURL,
			fetch: config.customFetch ?? config.ottorouterOptions?.fetch,
			promptCacheKey:
				config.sessionId ?? config.ottorouterOptions?.promptCacheKey,
		});
	}
	if (provider === 'xai') {
		if (isXaiGrokCliModel(model) && !config.oauth) {
			throw new Error('Grok Build and Grok Composer 2.5 require xAI OAuth.');
		}
		return createXaiModel(model, {
			apiKey: config.oauth?.access ?? config.apiKey,
			baseURL: config.baseURL,
			fetch: config.customFetch,
			promptCacheKey: config.sessionId,
			useResponses: !!config.oauth,
			useGrokCliProxy: !!config.oauth && isXaiGrokCliModel(model),
		});
	}
	if (provider === 'kimi') {
		return createKimiModel(model, {
			apiKey: config.apiKey,
			baseURL: config.baseURL,
			fetch: config.customFetch,
			oauth: config.oauth,
			projectRoot: config.projectRoot,
			promptCacheKey: config.sessionId,
		});
	}
	return createBuiltInProviderModel(provider, model, {
		...config,
		promptCacheKey: config.sessionId,
		customFetch:
			provider === 'anthropic'
				? (createAnthropicCachingFetch(config.customFetch) as typeof fetch)
				: provider === 'openai'
					? createPromptCacheKeyFetch(config.customFetch, config.sessionId)
					: config.customFetch,
	});
}
