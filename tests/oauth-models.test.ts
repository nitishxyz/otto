import { describe, expect, test } from 'bun:test';
import {
	catalog,
	filterModelsForAuthType,
	isModelAllowedForOAuth,
	normalizeModelCatalogPayload,
} from '@ottocode/sdk';

describe('oauth model filtering', () => {
	test('filters OpenAI OAuth models using explicit model ids', () => {
		const filtered = filterModelsForAuthType(
			'openai',
			catalog.openai.models,
			'oauth',
		).map((model) => model.id);

		expect(filtered).toContain('gpt-5.1-codex');
		expect(filtered).toContain('gpt-5.2');
		expect(filtered).toContain('gpt-5.2-codex');
		expect(filtered).toContain('gpt-5.3-codex');
		expect(filtered).toContain('gpt-5.4');
		expect(filtered).toContain('gpt-5.5');
		expect(filtered).not.toContain('gpt-5.2-chat-latest');
		expect(filtered).not.toContain('gpt-5.2-pro');
		expect(filtered).not.toContain('gpt-5.3-codex-spark');
		expect(filtered).not.toContain('gpt-5.4-pro');
	});

	test('does not filter OpenAI models for non-OAuth auth types', () => {
		const filtered = filterModelsForAuthType(
			'openai',
			catalog.openai.models,
			'api',
		);

		expect(filtered).toHaveLength(catalog.openai.models.length);
	});

	test('shows Grok CLI models only for xAI OAuth', () => {
		const oauthModels = filterModelsForAuthType(
			'xai',
			catalog.xai.models,
			'oauth',
		).map((model) => model.id);
		const apiModels = filterModelsForAuthType(
			'xai',
			catalog.xai.models,
			'api',
		).map((model) => model.id);

		expect(oauthModels).toContain('grok-build');
		expect(oauthModels).toContain('grok-composer-2.5-fast');
		expect(oauthModels).toContain('grok-4.3');
		expect(apiModels).not.toContain('grok-build');
		expect(apiModels).not.toContain('grok-composer-2.5-fast');
		expect(isModelAllowedForOAuth('xai', 'grok-composer-2.5-fast')).toBe(true);

		const composer = catalog.xai.models.find(
			(model) => model.id === 'grok-composer-2.5-fast',
		);
		expect(composer?.modalities?.input).toEqual(['text']);
		expect(composer?.attachment).toBe(false);
	});

	test('adds Grok CLI models to cached xAI catalog payloads', () => {
		const providers = normalizeModelCatalogPayload({
			xai: {
				id: 'xai',
				models: [
					{ id: 'grok-4.3', label: 'Grok 4.3' },
					{
						id: 'grok-composer-2.5-fast',
						label: 'Grok Composer 2.5 Fast',
						modalities: { input: ['text'], output: ['text'] },
						attachment: false,
					},
				],
			},
		});
		const modelIds = providers.xai.models.map((model) => model.id);
		const composer = providers.xai.models.find(
			(model) => model.id === 'grok-composer-2.5-fast',
		);

		expect(modelIds).toContain('grok-4.3');
		expect(modelIds).toContain('grok-build');
		expect(modelIds).toContain('grok-composer-2.5-fast');
		expect(composer?.modalities?.input).toEqual(['text']);
		expect(composer?.attachment).toBe(false);
	});

	test('keeps Anthropic OAuth prefix matching', () => {
		expect(isModelAllowedForOAuth('anthropic', 'claude-fable-5')).toBe(true);
		expect(isModelAllowedForOAuth('anthropic', 'claude-fable-5-20260609')).toBe(
			true,
		);
		expect(isModelAllowedForOAuth('anthropic', 'claude-sonnet-4-5')).toBe(true);
		expect(
			isModelAllowedForOAuth('anthropic', 'claude-sonnet-4-5-20251001'),
		).toBe(true);
		expect(isModelAllowedForOAuth('anthropic', 'claude-opus-4-8')).toBe(true);
		expect(
			isModelAllowedForOAuth('anthropic', 'claude-opus-4-8-20260529'),
		).toBe(true);
		expect(
			isModelAllowedForOAuth('anthropic', 'claude-3-5-sonnet-latest'),
		).toBe(false);
	});

	test('rejects OpenAI lookalike models that only share a prefix', () => {
		expect(isModelAllowedForOAuth('openai', 'gpt-5.2')).toBe(true);
		expect(isModelAllowedForOAuth('openai', 'gpt-5.5')).toBe(true);
		expect(isModelAllowedForOAuth('openai', 'gpt-5.2-chat-latest')).toBe(false);
		expect(isModelAllowedForOAuth('openai', 'gpt-5.4-pro')).toBe(false);
	});
});
