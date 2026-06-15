import { describe, expect, test } from 'bun:test';
import { buildReasoningConfig } from '../packages/server/src/runtime/provider/reasoning.ts';

describe('buildReasoningConfig', () => {
	test('disables reasoning for models without reasoning support', () => {
		const result = buildReasoningConfig({
			provider: 'openai',
			model: 'gpt-4o',
			reasoningText: true,
			reasoningLevel: 'xhigh',
			maxOutputTokens: 4000,
		});

		expect(result.enabled).toBe(false);
		expect(result.providerOptions).toEqual({});
		expect(result.effectiveMaxOutputTokens).toBe(4000);
	});

	test('uses adaptive Anthropic thinking for Claude 4.6 models', () => {
		const result = buildReasoningConfig({
			provider: 'anthropic',
			model: 'claude-sonnet-4-6',
			reasoningText: true,
			reasoningLevel: 'max',
			maxOutputTokens: 4000,
		});

		expect(result.enabled).toBe(true);
		expect(result.providerOptions).toEqual({
			anthropic: {
				thinking: { type: 'adaptive' },
				effort: 'max',
			},
		});
		expect(result.effectiveMaxOutputTokens).toBe(4000);
	});

	test('uses adaptive Anthropic thinking for Claude 4.7 models', () => {
		const result = buildReasoningConfig({
			provider: 'anthropic',
			model: 'claude-opus-4-7',
			reasoningText: true,
			reasoningLevel: 'xhigh',
			maxOutputTokens: 4000,
		});

		expect(result.enabled).toBe(true);
		expect(result.providerOptions).toEqual({
			anthropic: {
				thinking: { type: 'adaptive', display: 'summarized' },
				effort: 'xhigh',
			},
		});
		expect(result.effectiveMaxOutputTokens).toBe(4000);
	});

	test('uses OpenRouter request-level reasoning options', () => {
		const result = buildReasoningConfig({
			provider: 'openrouter',
			model: 'anthropic/claude-sonnet-4.6',
			reasoningText: true,
			reasoningLevel: 'medium',
			maxOutputTokens: 4000,
		});

		expect(result.enabled).toBe(true);
		expect(result.providerOptions).toEqual({
			openrouter: {
				reasoning: { effort: 'medium' },
			},
		});
	});

	test('uses OpenRouter request-level reasoning options for OttoRouter OpenRouter-backed models', () => {
		const result = buildReasoningConfig({
			provider: 'ottorouter',
			model: 'healer-alpha',
			reasoningText: true,
			reasoningLevel: 'medium',
			maxOutputTokens: 4000,
		});

		expect(result.enabled).toBe(true);
		expect(result.providerOptions).toEqual({
			openrouter: {
				reasoning: { effort: 'medium' },
			},
		});
	});

	test('uses shared OpenAI-compatible reasoning keys for Kimi', () => {
		const result = buildReasoningConfig({
			provider: 'kimi',
			model: 'kimi-k2.5',
			reasoningText: true,
			reasoningLevel: 'low',
			maxOutputTokens: 4000,
		});

		expect(result.enabled).toBe(true);
		expect(result.providerOptions).toMatchObject({
			openaiCompatible: { reasoningEffort: 'low' },
			kimi: { reasoningEffort: 'low' },
		});
	});

	test('maps OpenAI xhigh correctly for supported reasoning models', () => {
		const result = buildReasoningConfig({
			provider: 'openai',
			model: 'gpt-5',
			reasoningText: true,
			reasoningLevel: 'xhigh',
			maxOutputTokens: 4000,
		});

		expect(result.enabled).toBe(true);
		expect(result.providerOptions).toEqual({
			openai: {
				reasoningEffort: 'xhigh',
				reasoningSummary: 'auto',
			},
		});
	});

	test('adjusts Anthropic budget-based thinking by reasoning level', () => {
		const result = buildReasoningConfig({
			provider: 'anthropic',
			model: 'claude-sonnet-4-5-20250929',
			reasoningText: true,
			reasoningLevel: 'minimal',
			maxOutputTokens: 12000,
		});

		expect(result.enabled).toBe(true);
		expect(result.providerOptions).toEqual({
			anthropic: {
				thinking: { type: 'enabled', budgetTokens: 2048 },
			},
		});
		expect(result.effectiveMaxOutputTokens).toBe(9952);
	});

	test('uses Google thinkingLevel for Gemini 3 models', () => {
		const result = buildReasoningConfig({
			provider: 'google',
			model: 'gemini-3.1-pro-preview',
			reasoningText: true,
			reasoningLevel: 'medium',
			maxOutputTokens: 4000,
		});

		expect(result.enabled).toBe(true);
		expect(result.providerOptions).toEqual({
			google: {
				thinkingConfig: {
					thinkingLevel: 'medium',
					includeThoughts: true,
				},
			},
		});
	});
});
