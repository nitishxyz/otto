import { describe, expect, test } from 'bun:test';
import { normalizeUsage } from '../packages/server/src/runtime/session/db/usage.ts';

describe('session usage normalization', () => {
	test('separates Anthropic cache tokens when input includes them', () => {
		expect(
			normalizeUsage(
				{
					inputTokens: 26_766,
					outputTokens: 13,
					cachedInputTokens: 17_144,
					cacheCreationInputTokens: 9_620,
				},
				undefined,
				'anthropic',
			),
		).toEqual({
			inputTokens: 2,
			outputTokens: 13,
			cachedInputTokens: 17_144,
			cacheCreationInputTokens: 9_620,
			reasoningTokens: 0,
		});
	});

	test('keeps Anthropic uncached input when already reported separately', () => {
		expect(
			normalizeUsage(
				{ inputTokens: 2, outputTokens: 13 },
				{
					anthropic: {
						cacheReadInputTokens: 17_144,
						cacheCreationInputTokens: 9_620,
					},
				},
				'anthropic',
			).inputTokens,
		).toBe(2);
	});

	test('continues separating OpenAI cache reads', () => {
		expect(
			normalizeUsage(
				{ inputTokens: 10_000, cachedInputTokens: 8_000 },
				undefined,
				'openai',
			).inputTokens,
		).toBe(2_000);
	});
});
