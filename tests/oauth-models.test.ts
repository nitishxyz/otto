import { describe, expect, test } from 'bun:test';
import {
	catalog,
	filterModelsForAuthType,
	isModelAllowedForOAuth,
	normalizeModelCatalogPayload,
	type ModelInfoMap,
} from '@ottocode/sdk';

describe('oauth model filtering', () => {
	test('uses per-model catalog auth metadata', () => {
		const models: ModelInfoMap = {
			api: { id: 'api', auth: ['api'] },
			oauth: { id: 'oauth', auth: ['oauth'] },
			both: { id: 'both', auth: ['api', 'oauth'] },
			legacy: { id: 'legacy' },
			hidden: { id: 'hidden', auth: [] },
		};

		const api = filterModelsForAuthType('openai', models, 'api');
		const oauth = filterModelsForAuthType('openai', models, 'oauth');

		expect(Object.keys(api)).toEqual(['api', 'both', 'legacy']);
		expect(Object.keys(oauth)).toEqual(['oauth', 'both', 'legacy']);
	});

	test('filters OpenAI models using catalog auth metadata', () => {
		const filtered = filterModelsForAuthType(
			'openai',
			catalog.openai.models,
			'oauth',
		);
		const filteredIds = Object.keys(filtered);

		expect(filteredIds).toContain('gpt-5.2');
		expect(filteredIds).toContain('gpt-5.3-codex');
		expect(filteredIds).toContain('gpt-5.4');
		expect(filteredIds).toContain('gpt-5.5');
		expect(filteredIds).toContain('gpt-5.6');
		expect(filteredIds).toContain('gpt-5.6-luna');
		expect(filteredIds).toContain('gpt-5.6-sol');
		expect(filteredIds).toContain('gpt-5.6-terra');
		expect(filteredIds).toContain('gpt-6-astra');
		expect(filteredIds).not.toContain('gpt-5.2-chat-latest');
		expect(filteredIds).not.toContain('gpt-5.2-pro');
		expect(filteredIds).not.toContain('gpt-5.3-codex-spark');
		expect(filteredIds).not.toContain('gpt-5.4-pro');
		expect(catalog.openai.models['gpt-6-astra']?.auth).toEqual(['oauth']);
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

	test('filters OAuth-only OpenAI models from API auth', () => {
		const filtered = filterModelsForAuthType(
			'openai',
			catalog.openai.models,
			'api',
		);

		expect(filtered['gpt-6-astra']).toBeUndefined();
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

		expect(oauthModelIds).toContain('grok-composer-2.5-fast');
		expect(oauthModelIds).toContain('grok-4.5');
		expect(oauthModelIds).toContain('grok-4.6');
		expect(oauthModelIds).not.toContain('grok-build');
		expect(oauthModelIds).not.toContain('grok-4.3');
		expect(apiModelIds).not.toContain('grok-build');
		expect(apiModelIds).not.toContain('grok-composer-2.5-fast');
		expect(isModelAllowedForOAuth('xai', 'grok-composer-2.5-fast')).toBe(true);
		expect(isModelAllowedForOAuth('xai', 'grok-4.6')).toBe(true);
		expect(isModelAllowedForOAuth('xai', 'grok-4.3')).toBe(false);

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
					'grok-4.5': { id: 'grok-4.5', label: 'Grok 4.5' },
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

		expect(modelIds).toContain('grok-4.5');
		expect(modelIds).toContain('grok-4.3');
		expect(modelIds).toContain('grok-build');
		expect(modelIds).toContain('grok-composer-2.5-fast');
		expect(composer?.limit?.context).toBe(200_000);
		expect(composer?.modalities?.input).toEqual(['text']);
		expect(composer?.attachment).toBe(false);
		expect(composer?.auth).toEqual(['oauth']);
	});

	test('materializes Anthropic OAuth families into catalog metadata', () => {
		expect(isModelAllowedForOAuth('anthropic', 'claude-fable-5')).toBe(true);
		expect(catalog.anthropic.models['claude-fable-5']?.auth).toEqual([
			'api',
			'oauth',
		]);
		expect(isModelAllowedForOAuth('anthropic', 'claude-sonnet-4-5')).toBe(true);
		expect(
			isModelAllowedForOAuth('anthropic', 'claude-sonnet-4-5-20251001'),
		).toBe(false);
		expect(isModelAllowedForOAuth('anthropic', 'claude-opus-4-8')).toBe(true);
		expect(
			isModelAllowedForOAuth('anthropic', 'claude-opus-4-8-20260529'),
		).toBe(false);
		expect(isModelAllowedForOAuth('anthropic', 'claude-sonnet-5')).toBe(true);
		expect(isModelAllowedForOAuth('anthropic', 'claude-opus-5')).toBe(true);
		expect(catalog.anthropic.models['claude-opus-5']?.auth).toEqual([
			'api',
			'oauth',
		]);
		expect(
			isModelAllowedForOAuth('anthropic', 'claude-sonnet-5-20260701'),
		).toBe(false);
		expect(
			isModelAllowedForOAuth('anthropic', 'claude-3-5-sonnet-latest'),
		).toBe(false);
	});

	test('preserves auth metadata from a remote catalog payload', () => {
		const providers = normalizeModelCatalogPayload({
			providers: {
				openai: {
					id: 'openai',
					models: {
						'remote-oauth-release': {
							id: 'remote-oauth-release',
							auth: ['oauth'],
						},
						'remote-api-release': {
							id: 'remote-api-release',
							auth: ['api'],
						},
					},
				},
			},
		});

		const oauth = filterModelsForAuthType(
			'openai',
			providers.openai.models,
			'oauth',
		);
		expect(Object.keys(oauth)).toEqual(['remote-oauth-release']);
		expect(oauth['remote-oauth-release']?.auth).toEqual(['oauth']);
	});

	test('rejects OpenAI lookalike models that only share a prefix', () => {
		expect(isModelAllowedForOAuth('openai', 'gpt-5.2')).toBe(true);
		expect(isModelAllowedForOAuth('openai', 'gpt-5.5')).toBe(true);
		expect(isModelAllowedForOAuth('openai', 'gpt-5.6-terra')).toBe(true);
		expect(isModelAllowedForOAuth('openai', 'gpt-6-astra')).toBe(true);
		expect(isModelAllowedForOAuth('openai', 'gpt-5.2-chat-latest')).toBe(false);
		expect(isModelAllowedForOAuth('openai', 'gpt-5.4-pro')).toBe(false);
		expect(isModelAllowedForOAuth('openai', 'gpt-5.6-pro')).toBe(false);
	});
});
