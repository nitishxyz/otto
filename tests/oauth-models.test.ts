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
		);
		const filteredIds = Object.keys(filtered);

		expect(filteredIds).toContain('gpt-5.1-codex');
		expect(filteredIds).toContain('gpt-5.2');
		expect(filteredIds).toContain('gpt-5.2-codex');
		expect(filteredIds).toContain('gpt-5.3-codex');
		expect(filteredIds).toContain('gpt-5.4');
		expect(filteredIds).toContain('gpt-5.5');
		expect(filteredIds).not.toContain('gpt-5.2-chat-latest');
		expect(filteredIds).not.toContain('gpt-5.2-pro');
		expect(filteredIds).not.toContain('gpt-5.3-codex-spark');
		expect(filteredIds).not.toContain('gpt-5.4-pro');
	});

	test('overrides gpt-5.5 context limit to 264k only for OAuth', () => {
		const oauth = filterModelsForAuthType(
			'openai',
			catalog.openai.models,
			'oauth',
		);
		const api = filterModelsForAuthType('openai', catalog.openai.models, 'api');

		expect(oauth['gpt-5.5']?.limit?.context).toBe(264_000);
		expect(api['gpt-5.5']?.limit?.context).toBe(
			catalog.openai.models['gpt-5.5']?.limit?.context,
		);
		expect(api['gpt-5.5']?.limit?.context).not.toBe(264_000);
	});

	test('does not filter OpenAI models for non-OAuth auth types', () => {
		const filtered = filterModelsForAuthType(
			'openai',
			catalog.openai.models,
			'api',
		);

		expect(Object.keys(filtered)).toHaveLength(
			Object.keys(catalog.openai.models).length,
		);
	});

	test('shows Grok CLI models only for xAI OAuth', () => {
		const oauthModels = filterModelsForAuthType(
			'xai',
			catalog.xai.models,
			'oauth',
		);
		const apiModels = filterModelsForAuthType('xai', catalog.xai.models, 'api');
		const oauthModelIds = Object.keys(oauthModels);
		const apiModelIds = Object.keys(apiModels);

		expect(oauthModelIds).toContain('grok-build');
		expect(oauthModelIds).toContain('grok-composer-2.5-fast');
		expect(oauthModelIds).toContain('grok-4.3');
		expect(apiModelIds).not.toContain('grok-build');
		expect(apiModelIds).not.toContain('grok-composer-2.5-fast');
		expect(isModelAllowedForOAuth('xai', 'grok-composer-2.5-fast')).toBe(true);

		const composer = catalog.xai.models['grok-composer-2.5-fast'];
		const build = catalog.xai.models['grok-build'];
		expect(build?.limit?.context).toBe(512_000);
		expect(composer?.limit?.context).toBe(200_000);
		expect(composer?.modalities?.input).toEqual(['text']);
		expect(composer?.attachment).toBe(false);
	});

	test('adds Grok CLI models to cached xAI catalog payloads', () => {
		const providers = normalizeModelCatalogPayload({
			xai: {
				id: 'xai',
				models: {
					'grok-4.3': { id: 'grok-4.3', label: 'Grok 4.3' },
					'grok-composer-2.5-fast': {
						id: 'grok-composer-2.5-fast',
						label: 'Grok Composer 2.5 Fast',
						modalities: { input: ['text'], output: ['text'] },
						attachment: false,
					},
				},
			},
		});
		const modelIds = Object.keys(providers.xai.models);
		const composer = providers.xai.models['grok-composer-2.5-fast'];

		expect(modelIds).toContain('grok-4.3');
		expect(modelIds).toContain('grok-build');
		expect(modelIds).toContain('grok-composer-2.5-fast');
		expect(composer?.limit?.context).toBe(200_000);
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
