import {
	catalog,
	getProviderDefinition,
	isBuiltInProviderId,
	type OttoConfig,
	type ProviderId,
	type ReasoningLevel,
} from '@ottocode/sdk';
import type { ReasoningConfigResult } from './reasoning.ts';

const THINKING_BUDGET = 16000;

type ReasoningBuilderArgs = {
	cfg?: OttoConfig;
	provider: ProviderId;
	model: string;
	reasoningLevel?: ReasoningLevel;
	maxOutputTokens: number | undefined;
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
			return supportsAnthropicXhighEffort(model) ? 'xhigh' : 'max';
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

function matchesAnyClaudeModel(model: string, names: string[]): boolean {
	const lower = model.toLowerCase().replace(/\./g, '-');
	return names.some((name) => lower.includes(name));
}

// Models where thinking { type: 'enabled', budget_tokens } is rejected (400)
// or deprecated; adaptive thinking with `effort` is required/recommended.
// See https://platform.claude.com/docs/en/build-with-claude/extended-thinking
function usesAdaptiveAnthropicThinking(model: string): boolean {
	return matchesAnyClaudeModel(model, [
		'claude-opus-4-6',
		'claude-opus-4-7',
		'claude-opus-4-8',
		'claude-sonnet-4-6',
		'claude-sonnet-5',
		'claude-fable-5',
		'claude-mythos',
	]);
}

// xhigh effort is only accepted on these models; others reject it with 400.
// See https://platform.claude.com/docs/en/build-with-claude/effort
function supportsAnthropicXhighEffort(model: string): boolean {
	return matchesAnyClaudeModel(model, [
		'claude-opus-4-7',
		'claude-opus-4-8',
		'claude-sonnet-5',
		'claude-fable-5',
		'claude-mythos-5',
	]);
}

export function buildAnthropicReasoningOptions({
	model,
	reasoningLevel,
	maxOutputTokens,
}: ReasoningBuilderArgs): ReasoningConfigResult {
	if (usesAdaptiveAnthropicThinking(model)) {
		return {
			providerOptions: {
				anthropic: {
					// Explicit display is required to receive thinking text on
					// models where display defaults to 'omitted' (Opus 4.7/4.8,
					// Sonnet 5, Fable 5, Mythos); it is a no-op on 4.6 models.
					thinking: { type: 'adaptive', display: 'summarized' },
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

export function buildOpenAIReasoningOptions({
	reasoningLevel,
	maxOutputTokens,
}: ReasoningBuilderArgs): ReasoningConfigResult {
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

export function buildGoogleReasoningOptions({
	model,
	reasoningLevel,
	maxOutputTokens,
}: ReasoningBuilderArgs): ReasoningConfigResult {
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
							thinkingBudget: toThinkingBudget(reasoningLevel, maxOutputTokens),
							includeThoughts: true,
						},
			},
		},
		effectiveMaxOutputTokens: maxOutputTokens,
		enabled: true,
	};
}

export function buildOllamaReasoningOptions({
	maxOutputTokens,
}: ReasoningBuilderArgs): ReasoningConfigResult {
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

export function buildOpenRouterReasoningOptions({
	reasoningLevel,
	maxOutputTokens,
}: ReasoningBuilderArgs): ReasoningConfigResult {
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

export function buildOpenAICompatibleReasoningOptions({
	cfg,
	provider,
	reasoningLevel,
	maxOutputTokens,
}: ReasoningBuilderArgs): ReasoningConfigResult {
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
