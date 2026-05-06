import type { OttoConfig, ProviderId } from '@ottocode/sdk';
import {
	getConfiguredProviderApiKey,
	getProviderDefinition,
	isBuiltInProviderId,
	normalizeOllamaBaseURL,
} from '@ottocode/sdk';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOllama } from 'ai-sdk-ollama';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
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
import { getMoonshotInstance } from './moonshot.ts';
import { getMinimaxInstance } from './minimax.ts';
import { resolveCopilotModel } from './copilot.ts';

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
	if (provider === 'moonshot') {
		return getMoonshotInstance(cfg, model);
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

function needsResponsesApi(model: string): boolean {
	const lower = model.toLowerCase();
	return (
		lower.includes('gpt-5') ||
		lower.startsWith('o1') ||
		lower.startsWith('o3') ||
		lower.startsWith('o4') ||
		lower.includes('codex-mini')
	);
}

function resolveCustomConfiguredModel(
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
		const instance = createOpenAI({ apiKey, baseURL });
		return needsResponsesApi(model)
			? instance.responses(model)
			: instance(model);
	}

	if (definition.compatibility === 'anthropic') {
		const instance = createAnthropic({ apiKey, baseURL });
		return instance(model);
	}

	if (definition.compatibility === 'google') {
		const instance = createGoogleGenerativeAI({ apiKey, baseURL });
		return instance(model);
	}

	if (definition.compatibility === 'openrouter') {
		const instance = createOpenRouter({ apiKey, baseURL });
		return instance.chat(model);
	}

	if (definition.compatibility === 'ollama') {
		const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
		const ollamaBaseURL = normalizeOllamaBaseURL(baseURL);
		const instance = createOllama({
			baseURL: ollamaBaseURL,
			headers,
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
	});
	return instance(model);
}
