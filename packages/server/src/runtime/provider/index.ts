import type { OttoConfig, ProviderId } from '@ottocode/sdk';
import { getProviderDefinition, isBuiltInProviderId } from '@ottocode/sdk';
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
	if (provider === 'ollama-cloud') {
		const definition = getProviderDefinition(cfg, provider);
		if (!definition) {
			throw new Error(`Unsupported provider: ${provider}`);
		}
		return resolveCustomConfiguredModel(definition, cfg, model, options);
	}
	if (provider === 'huggingface') {
		const definition = getProviderDefinition(cfg, provider);
		if (!definition) {
			throw new Error(`Unsupported provider: ${provider}`);
		}
		return resolveCustomConfiguredModel(definition, cfg, model, options);
	}
	if (provider === 'openrouter') {
		return resolveOpenRouterModel(model);
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
		return getKimiInstance(cfg, model);
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
