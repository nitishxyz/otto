import { describe, it, expect } from 'bun:test';
import { catalog, providerIds } from '@ottocode/sdk';

describe('ottorouter catalog entry', () => {
	it('adds ottorouter to providerIds', () => {
		expect(providerIds).toContain('ottorouter');
	});

	it('sources models from ottorouterCatalog with gpt-5-codex default', () => {
		const entry = catalog.ottorouter;
		expect(entry).toBeDefined();
		expect(entry?.models.length).toBeGreaterThan(0);
		expect(entry?.models[0]?.id).toBe('gpt-5-codex');
		const providers = new Set(
			entry?.models
				.map((model) => model.provider?.npm)
				.filter((val): val is string => Boolean(val)),
		);
		expect(providers).toEqual(
			new Set([
				'@ai-sdk/openai',
				'@ai-sdk/anthropic',
				'@ai-sdk/google',
				'@ai-sdk/openai-compatible',
				'@ai-sdk/xai',
			]),
		);
	});

	it('tracks DeepSeek-owned OttoRouter models from the catalog', () => {
		const entry = catalog.ottorouter;
		const model = entry?.models.find((m) => m.id === 'deepseek-chat');
		expect(model?.ownedBy).toBe('deepseek');
	});

	it('maps Moonshot-owned OttoRouter models to Kimi', () => {
		const entry = catalog.ottorouter;
		const model = entry?.models.find((m) => m.id === 'kimi-k2-thinking');
		expect(model?.ownedBy).toBe('kimi');
		expect(
			entry?.models.some(
				(m) => (m.ownedBy as string | undefined) === 'moonshot',
			),
		).toBe(false);
	});

	it('has cost and limit from ottorouter API', () => {
		const entry = catalog.ottorouter;
		const model = entry?.models.find((m) => m.id === 'gpt-5-codex');
		expect(model?.cost?.input).toBeGreaterThan(0);
		expect(model?.cost?.output).toBeGreaterThan(0);
		expect(model?.limit?.context).toBeGreaterThan(0);
		expect(model?.limit?.output).toBeGreaterThan(0);
	});

	it('every model has ownedBy set', () => {
		const entry = catalog.ottorouter;
		for (const model of entry?.models ?? []) {
			expect(model.ownedBy).toBeDefined();
		}
	});
});
