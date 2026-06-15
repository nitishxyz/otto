import {
	getConfiguredProviderFamily,
	getProviderDefinition,
	getModelNpmBinding,
	getUnderlyingProviderKey,
	modelSupportsReasoning,
	type OttoConfig,
	type ProviderId,
	type ReasoningLevel,
} from '@ottocode/sdk';
import {
	buildAnthropicReasoningOptions,
	buildGoogleReasoningOptions,
	buildOllamaReasoningOptions,
	buildOpenAICompatibleReasoningOptions,
	buildOpenAIReasoningOptions,
	buildOpenRouterReasoningOptions,
} from './reasoning-builders.ts';

export type ReasoningConfigResult = {
	providerOptions: Record<string, unknown>;
	effectiveMaxOutputTokens: number | undefined;
	enabled: boolean;
};

type ReasoningProviderTarget =
	| 'anthropic'
	| 'openai'
	| 'google'
	| 'ollama'
	| 'openai-compatible'
	| 'openrouter';

function getReasoningProviderTarget(
	provider: ProviderId,
	model: string,
	cfg?: OttoConfig,
): ReasoningProviderTarget | null {
	const definition = cfg ? getProviderDefinition(cfg, provider) : undefined;
	if (definition?.source === 'custom') {
		if (definition.compatibility === 'anthropic') return 'anthropic';
		if (definition.compatibility === 'openai') return 'openai';
		if (definition.compatibility === 'google') return 'google';
		if (definition.compatibility === 'ollama') return 'ollama';
		if (definition.compatibility === 'openrouter') return 'openrouter';
		return 'openai-compatible';
	}

	if (provider === 'ottorouter') return 'openrouter';
	if (provider === 'openrouter') return 'openrouter';
	if (definition?.compatibility === 'ollama') return 'ollama';
	if (provider === 'kimi' || provider === 'zai' || provider === 'zai-coding') {
		return 'openai-compatible';
	}
	if (provider === 'minimax') return 'anthropic';

	const npmBinding = getModelNpmBinding(provider, model);
	if (npmBinding === '@ai-sdk/anthropic') return 'anthropic';
	if (npmBinding === '@ai-sdk/openai') return 'openai';
	if (npmBinding === '@ai-sdk/xai') return 'openai';
	if (npmBinding === '@ai-sdk/google') return 'google';
	if (npmBinding === 'ai-sdk-ollama') return 'ollama';
	if (npmBinding === '@ai-sdk/openai-compatible') return 'openai-compatible';
	if (npmBinding === '@openrouter/ai-sdk-provider') return 'openrouter';

	const underlyingProvider = getUnderlyingProviderKey(provider, model);
	if (underlyingProvider === 'anthropic') return 'anthropic';
	if (underlyingProvider === 'openai') return 'openai';
	if (underlyingProvider === 'google') return 'google';
	if (underlyingProvider === 'openai-compatible') return 'openai-compatible';

	const family = cfg ? getConfiguredProviderFamily(cfg, provider, model) : null;
	if (family === 'anthropic') return 'anthropic';
	if (family === 'openai') return 'openai';
	if (family === 'google') return 'google';
	if (family === 'openai-compatible') return 'openai-compatible';
	return null;
}

function isReasoningSupported(args: {
	cfg?: OttoConfig;
	provider: ProviderId;
	model: string;
}): boolean {
	const { cfg, provider, model } = args;
	const definition = cfg ? getProviderDefinition(cfg, provider) : undefined;
	if (definition?.compatibility === 'ollama') return true;
	if (definition?.source === 'custom') return true;
	if (provider === 'ottorouter') return true;
	return modelSupportsReasoning(provider, model);
}

function buildTargetReasoningConfig(
	target: ReasoningProviderTarget,
	args: {
		cfg?: OttoConfig;
		provider: ProviderId;
		model: string;
		reasoningLevel?: ReasoningLevel;
		maxOutputTokens: number | undefined;
	},
): ReasoningConfigResult {
	switch (target) {
		case 'anthropic':
			return buildAnthropicReasoningOptions(args);
		case 'openai':
			return buildOpenAIReasoningOptions(args);
		case 'google':
			return buildGoogleReasoningOptions(args);
		case 'ollama':
			return buildOllamaReasoningOptions(args);
		case 'openrouter':
			return buildOpenRouterReasoningOptions(args);
		case 'openai-compatible':
			return buildOpenAICompatibleReasoningOptions(args);
	}
}

export function buildReasoningConfig(args: {
	cfg?: OttoConfig;
	provider: ProviderId;
	model: string;
	reasoningText?: boolean;
	reasoningLevel?: ReasoningLevel;
	maxOutputTokens: number | undefined;
}): ReasoningConfigResult {
	const {
		cfg,
		provider,
		model,
		reasoningText,
		reasoningLevel,
		maxOutputTokens,
	} = args;

	if (!reasoningText || !isReasoningSupported({ cfg, provider, model })) {
		return {
			providerOptions: {},
			effectiveMaxOutputTokens: maxOutputTokens,
			enabled: false,
		};
	}

	const reasoningTarget = getReasoningProviderTarget(provider, model, cfg);
	if (!reasoningTarget) {
		return {
			providerOptions: {},
			effectiveMaxOutputTokens: maxOutputTokens,
			enabled: false,
		};
	}

	return buildTargetReasoningConfig(reasoningTarget, {
		cfg,
		provider,
		model,
		reasoningLevel,
		maxOutputTokens,
	});
}
