import type { OttoConfig, ProviderId } from '@ottocode/sdk';
import {
	createBasetenModel,
	createHuggingFaceModel,
	createWaferModel,
	createMetaModel,
	getConfiguredProviderApiKey,
	getProviderDefinition,
	isBuiltInProviderId,
} from '@ottocode/sdk';
import { getAnthropicInstance } from './anthropic.ts';
import { resolveOpenAIModel } from './openai.ts';
import { resolveGoogleModel } from './google.ts';
import { resolveOpenRouterModel } from './openrouter.ts';
import {
	resolveOttoRouterModel,
	type ResolveOttoRouterModelOptions,
} from './ottorouter.ts';
import { getXaiInstance } from './xai.ts';
import { getZaiInstance, getZaiCodingInstance } from './zai.ts';
import { resolveOpencodeModel } from './opencode.ts';
import { getDeepSeekInstance } from './deepseek.ts';
import { getKimiInstance } from './kimi.ts';
import { getMinimaxInstance } from './minimax.ts';
import { resolveCopilotModel } from './copilot.ts';
import { resolveCustomConfiguredModel } from './custom.ts';
import { providerFetch } from './fetch.ts';

export type ProviderName = ProviderId;

export async function resolveModel(
	provider: ProviderName,
	model: string,
	cfg: OttoConfig,
	options?: {
		systemPrompt?: string;
		sessionId?: string;
		messageId?: string;
		reasoningText?: boolean;
		topupApprovalMode?: ResolveOttoRouterModelOptions['topupApprovalMode'];
		autoPayThresholdUsd?: ResolveOttoRouterModelOptions['autoPayThresholdUsd'];
	},
) {
	if (provider === 'openai') {
		return resolveOpenAIModel(model, cfg, options?.sessionId);
	}
	if (provider === 'anthropic') {
		const instance = await getAnthropicInstance(cfg);
		return instance(model);
	}
	if (provider === 'google') {
		return resolveGoogleModel(model, cfg);
	}
	if (provider === 'meta') {
		const definition = getProviderDefinition(cfg, provider);
		if (!definition) {
			throw new Error(`Unsupported provider: ${provider}`);
		}
		return createMetaModel(model, {
			apiKey: getConfiguredProviderApiKey(cfg, provider),
			baseURL: definition.baseURL,
			fetch: providerFetch,
		});
	}
	if (provider === 'ollama-cloud') {
		const definition = getProviderDefinition(cfg, provider);
		if (!definition) {
			throw new Error(`Unsupported provider: ${provider}`);
		}
		return resolveCustomConfiguredModel(definition, cfg, model, options);
	}
	if (provider === 'baseten') {
		const definition = getProviderDefinition(cfg, provider);
		if (!definition) {
			throw new Error(`Unsupported provider: ${provider}`);
		}
		return createBasetenModel(model, {
			apiKey: getConfiguredProviderApiKey(cfg, provider),
			baseURL: definition.baseURL,
			fetch: providerFetch,
		});
	}
	if (provider === 'huggingface') {
		const definition = getProviderDefinition(cfg, provider);
		if (!definition) {
			throw new Error(`Unsupported provider: ${provider}`);
		}
		return createHuggingFaceModel(model, {
			apiKey: getConfiguredProviderApiKey(cfg, provider),
			baseURL: definition.baseURL,
			fetch: providerFetch,
		});
	}
	if (provider === 'wafer') {
		const definition = getProviderDefinition(cfg, provider);
		if (!definition) {
			throw new Error(`Unsupported provider: ${provider}`);
		}
		return createWaferModel(model, {
			apiKey: getConfiguredProviderApiKey(cfg, provider),
			baseURL: definition.baseURL,
			fetch: providerFetch,
		});
	}
	if (provider === 'openrouter') {
		return resolveOpenRouterModel(model, options?.sessionId);
	}
	if (provider === 'opencode') {
		return resolveOpencodeModel(model, cfg);
	}
	if (provider === 'copilot') {
		return resolveCopilotModel(model, cfg);
	}
	if (provider === 'ottorouter') {
		return await resolveOttoRouterModel(model, options?.sessionId, {
			messageId: options?.messageId,
			projectRoot: cfg.projectRoot,
			topupApprovalMode: options?.topupApprovalMode,
			autoPayThresholdUsd: options?.autoPayThresholdUsd,
		});
	}
	if (provider === 'xai') {
		return getXaiInstance(cfg, model);
	}
	if (provider === 'zai') {
		return getZaiInstance(cfg, model);
	}
	if (provider === 'zai-coding') {
		return getZaiCodingInstance(cfg, model);
	}
	if (provider === 'deepseek') {
		return getDeepSeekInstance(cfg, model);
	}
	if (provider === 'kimi') {
		return getKimiInstance(cfg, model, options?.sessionId);
	}
	if (provider === 'minimax') {
		return getMinimaxInstance(cfg, model);
	}

	const definition = getProviderDefinition(cfg, provider);
	if (definition && !isBuiltInProviderId(provider)) {
		return resolveCustomConfiguredModel(definition, cfg, model, options);
	}
	throw new Error(`Unsupported provider: ${provider}`);
}
