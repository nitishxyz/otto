import {
	catalog,
	getConfiguredProviderFamily,
	getProviderDefinition,
	getModelNpmBinding,
	getUnderlyingProviderKey,
	isBuiltInProviderId,
	modelSupportsReasoning,
	type OttoConfig,
	type ProviderId,
	type ReasoningLevel,
} from '@ottocode/sdk';

const THINKING_BUDGET = 16000;

export type ReasoningConfigResult = {
	providerOptions: Record<string, unknown>;
	effectiveMaxOutputTokens: number | undefined;
	enabled: boolean;
};

function normalizeReasoningLevel(
	level: ReasoningLevel | undefined,
): Exclude<ReasoningLevel, 'xhigh'> {
	if (!level) return 'high';
	if (level === 'xhigh') return 'high';
	return level;
}

function toAnthropicEffort(
	model: string,
	level: ReasoningLevel | undefined,
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
	switch (level) {
		case 'minimal':
		case 'low':
			return 'low';
		case 'medium':
			return 'medium';
		case 'max':
			return 'max';
		case 'xhigh':
			return isClaudeOpus47(model) ? 'xhigh' : 'max';
		default:
			return 'high';
	}
}

function toOpenAIEffort(
	level: ReasoningLevel | undefined,
): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
	switch (level) {
		case 'minimal':
			return 'minimal';
		case 'low':
			return 'low';
		case 'medium':
			return 'medium';
		case 'max':
		case 'xhigh':
			return 'xhigh';
		default:
			return 'high';
	}
}

function toGoogleThinkingLevel(
	level: ReasoningLevel | undefined,
): 'minimal' | 'low' | 'medium' | 'high' {
	switch (level) {
		case 'minimal':
			return 'minimal';
		case 'low':
			return 'low';
		case 'medium':
			return 'medium';
		default:
			return 'high';
	}
}

function toThinkingBudget(
	level: ReasoningLevel | undefined,
	maxOutputTokens: number | undefined,
): number {
	const cap = maxOutputTokens
		? Math.max(maxOutputTokens, THINKING_BUDGET)
		: THINKING_BUDGET;
	switch (level) {
		case 'minimal':
			return Math.min(2048, cap);
		case 'low':
			return Math.min(4096, cap);
		case 'medium':
			return Math.min(8192, cap);
		case 'max':
		case 'xhigh':
			return Math.min(24000, cap);
		default:
			return Math.min(16000, cap);
	}
}

function toCamelCaseKey(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9]+/g, ' ')
		.trim()
		.split(/\s+/)
		.map((segment, index) => {
			const lower = segment.toLowerCase();
			if (index === 0) return lower;
			return lower.charAt(0).toUpperCase() + lower.slice(1);
		})
		.join('');
}

function getOpenAICompatibleProviderOptionKeys(
	provider: ProviderId,
	cfg?: OttoConfig,
): string[] {
	const definition = cfg ? getProviderDefinition(cfg, provider) : undefined;
	const entry = isBuiltInProviderId(provider) ? catalog[provider] : undefined;
	const keys = new Set<string>(['openaiCompatible', toCamelCaseKey(provider)]);
	const label = definition?.label ?? entry?.label;
	if (label) {
		keys.add(toCamelCaseKey(label));
	}
	return Array.from(keys).filter(Boolean);
}

function buildSharedProviderOptions(
	provider: ProviderId,
	options: Record<string, unknown>,
	cfg?: OttoConfig,
): Record<string, unknown> {
	const keys = getOpenAICompatibleProviderOptionKeys(provider, cfg);
	return Object.fromEntries(keys.map((key) => [key, options]));
}

function isClaudeOpus47(model: string): boolean {
	const lower = model.toLowerCase();
	return lower.includes('claude-opus-4-7') || lower.includes('claude-opus-4.7');
}

function usesAdaptiveAnthropicThinking(model: string): boolean {
	const lower = model.toLowerCase();
	return (
		isClaudeOpus47(model) ||
		lower.includes('claude-opus-4-6') ||
		lower.includes('claude-opus-4.6') ||
		lower.includes('claude-sonnet-4-6') ||
		lower.includes('claude-sonnet-4.6')
	);
}

function getReasoningProviderTarget(
	provider: ProviderId,
	model: string,
	cfg?: OttoConfig,
):
	| 'anthropic'
	| 'openai'
	| 'google'
	| 'ollama'
	| 'openai-compatible'
	| 'openrouter'
	| null {
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
	if (
		provider === 'moonshot' ||
		provider === 'zai' ||
		provider === 'zai-coding'
	) {
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
	const definition = cfg ? getProviderDefinition(cfg, provider) : undefined;
	const supportsReasoning =
		definition?.compatibility === 'ollama'
			? true
			: definition?.source === 'custom'
				? true
				: provider === 'ottorouter'
					? true
					: modelSupportsReasoning(provider, model);
	if (!reasoningText || !supportsReasoning) {
		return {
			providerOptions: {},
			effectiveMaxOutputTokens: maxOutputTokens,
			enabled: false,
		};
	}

	const reasoningTarget = getReasoningProviderTarget(provider, model, cfg);
	if (reasoningTarget === 'anthropic') {
		if (usesAdaptiveAnthropicThinking(model)) {
			const thinking = isClaudeOpus47(model)
				? { type: 'adaptive', display: 'summarized' }
				: { type: 'adaptive' };

			return {
				providerOptions: {
					anthropic: {
						thinking,
						effort: toAnthropicEffort(model, reasoningLevel),
					},
				},
				effectiveMaxOutputTokens: maxOutputTokens,
				enabled: true,
			};
		}

		const thinkingBudget = toThinkingBudget(reasoningLevel, maxOutputTokens);

		return {
			providerOptions: {
				anthropic: {
					thinking: { type: 'enabled', budgetTokens: thinkingBudget },
				},
			},
			effectiveMaxOutputTokens:
				maxOutputTokens && maxOutputTokens > thinkingBudget
					? maxOutputTokens - thinkingBudget
					: maxOutputTokens,
			enabled: true,
		};
	}

	if (reasoningTarget === 'openai') {
		return {
			providerOptions: {
				openai: {
					reasoningEffort: toOpenAIEffort(reasoningLevel),
					reasoningSummary: 'auto',
				},
			},
			effectiveMaxOutputTokens: maxOutputTokens,
			enabled: true,
		};
	}

	if (reasoningTarget === 'google') {
		const isGemini3 = model.includes('gemini-3');
		return {
			providerOptions: {
				google: {
					thinkingConfig: isGemini3
						? {
								thinkingLevel: toGoogleThinkingLevel(reasoningLevel),
								includeThoughts: true,
							}
						: {
								thinkingBudget: toThinkingBudget(
									reasoningLevel,
									maxOutputTokens,
								),
								includeThoughts: true,
							},
				},
			},
			effectiveMaxOutputTokens: maxOutputTokens,
			enabled: true,
		};
	}

	if (reasoningTarget === 'ollama') {
		return {
			providerOptions: {
				ollama: {
					think: true,
				},
			},
			effectiveMaxOutputTokens: maxOutputTokens,
			enabled: true,
		};
	}

	if (reasoningTarget === 'openrouter') {
		return {
			providerOptions: {
				openrouter: {
					reasoning: { effort: normalizeReasoningLevel(reasoningLevel) },
				},
			},
			effectiveMaxOutputTokens: maxOutputTokens,
			enabled: true,
		};
	}

	if (reasoningTarget === 'openai-compatible') {
		return {
			providerOptions: buildSharedProviderOptions(
				provider,
				{
					reasoningEffort: normalizeReasoningLevel(reasoningLevel),
				},
				cfg,
			),
			effectiveMaxOutputTokens: maxOutputTokens,
			enabled: true,
		};
	}

	return {
		providerOptions: {},
		effectiveMaxOutputTokens: maxOutputTokens,
		enabled: false,
	};
}
