import type { OttoConfig, ProviderId } from '@ottocode/sdk';
import { getProviderDefinition, isBuiltInProviderId } from '@ottocode/sdk';
import { createProviderModel } from '@ottocode/sdk/providers';
import { getAnthropicInstance } from './anthropic.ts';
import { resolveOpenAIModel } from './openai.ts';
import {
	resolveOttoRouterModel,
	type ResolveOttoRouterModelOptions,
} from './ottorouter.ts';
import { getXaiInstance } from './xai.ts';
import { getKimiInstance } from './kimi.ts';
import { resolveCopilotModel } from './copilot.ts';
import { resolveCustomConfiguredModel } from './custom.ts';
import { providerFetch } from './fetch.ts';
import { getRequestApiKey, getRunProviderApiKey } from './credentials.ts';

export type ProviderName = ProviderId;
type ResolveModelOptions = {
	systemPrompt?: string;
	sessionId?: string;
	messageId?: string;
	reasoningText?: boolean;
	topupApprovalMode?: ResolveOttoRouterModelOptions['topupApprovalMode'];
	autoPayThresholdUsd?: ResolveOttoRouterModelOptions['autoPayThresholdUsd'];
	abortSignal?: AbortSignal;
};

// Only auth selection, discovery and payment policy remain server-specific.
const serverAdapters = {
	anthropic: async (model: string, cfg: OttoConfig) =>
		(await getAnthropicInstance(cfg))(model),
	openai: (model: string, cfg: OttoConfig, options?: ResolveModelOptions) =>
		resolveOpenAIModel(model, cfg, options?.sessionId),
	xai: (model: string, cfg: OttoConfig, options?: ResolveModelOptions) =>
		getXaiInstance(cfg, model, options?.sessionId),
	kimi: (model: string, cfg: OttoConfig, options?: ResolveModelOptions) =>
		getKimiInstance(cfg, model, options?.sessionId),
	copilot: (model: string, cfg: OttoConfig, options?: ResolveModelOptions) =>
		resolveCopilotModel(model, cfg, options?.abortSignal),
	ottorouter: (model: string, cfg: OttoConfig, options?: ResolveModelOptions) =>
		resolveOttoRouterModel(model, options?.sessionId, {
			messageId: options?.messageId,
			projectRoot: cfg.projectRoot,
			baseURL: cfg.providers.ottorouter?.baseURL,
			topupApprovalMode: options?.topupApprovalMode,
			autoPayThresholdUsd: options?.autoPayThresholdUsd,
		}),
};

export async function resolveModel(
	provider: ProviderName,
	model: string,
	cfg: OttoConfig,
	options?: ResolveModelOptions,
) {
	const definition = getProviderDefinition(cfg, provider);
	if (!definition) throw new Error(`Unsupported provider: ${provider}`);
	const requestApiKey = getRequestApiKey(provider);
	if (!isBuiltInProviderId(provider) || provider === 'ollama-cloud') {
		return resolveCustomConfiguredModel(definition, cfg, model, {
			...options,
			apiKey: requestApiKey ?? (await getRunProviderApiKey(cfg, provider)),
		});
	}
	if (requestApiKey === undefined && provider in serverAdapters) {
		return serverAdapters[provider as keyof typeof serverAdapters](
			model,
			cfg,
			options,
		);
	}
	return createProviderModel(provider, model, {
		apiKey: requestApiKey ?? (await getRunProviderApiKey(cfg, provider)),
		baseURL:
			provider === 'opencode'
				? cfg.providers.opencode?.baseURL
				: definition.baseURL,
		customFetch: providerFetch,
		projectRoot: cfg.projectRoot,
		sessionId: options?.sessionId,
	});
}
