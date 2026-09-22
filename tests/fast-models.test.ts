import { describe, expect, test } from 'bun:test';
import { catalog } from '../packages/sdk/src/providers/src/catalog-merged.ts';
import {
	getFastModel,
	getFastModelForAuth,
} from '../packages/sdk/src/providers/src/utils.ts';

/**
 * Expected lightweight model per provider (titles, summaries, compaction).
 * The same model is expected for API-key and OAuth auth.
 */
const EXPECTED: Array<[provider: string, model: string]> = [
	['openai', 'gpt-6-luna'],
	['anthropic', 'claude-haiku-4-5'],
	['google', 'gemini-3.8-flash'],
	['meta', 'muse-spark-1.3'],
	['baseten', 'deepseek-ai/DeepSeek-V4.1-Flash'],
	['huggingface', 'deepseek-ai/DeepSeek-V4.1-Flash'],
	['wafer', 'MiniMax-M3'],
	['openrouter', 'openai/gpt-6-luna'],
	['opencode', 'gpt-6-luna'],
	['ottorouter', 'gpt-5.6-luna'],
	['xai', 'grok-4.7'],
	['zai', 'glm-5.3-flash'],
	['deepseek', 'deepseek-v4-flash'],
	['copilot', 'gpt-5.6-luna'],
	['kimi', 'kimi-k2.7-code'],
	['minimax', 'MiniMax-M3'],
];

describe('fast model selection per provider', () => {
	test.each(EXPECTED)('%s -> %s', (provider, model) => {
		expect(getFastModel(provider)).toBe(model);
		expect(getFastModelForAuth(provider, 'api')).toBe(model);
		expect(getFastModelForAuth(provider, 'oauth')).toBe(model);
	});

	test.each(EXPECTED)(
		'%s fast model exists and supports tools',
		(provider, model) => {
			const info = catalog[provider as keyof typeof catalog]?.models[model];
			expect(info).toBeDefined();
			expect(info?.toolCall).not.toBe(false);
		},
	);

	test('OAuth falls back to general preferences, never to the cheapest free model', () => {
		expect(getFastModelForAuth('opencode', 'oauth')).not.toBe('big-pickle');
		expect(getFastModelForAuth('openrouter', 'oauth')).not.toMatch(/:free$/);
	});
});
