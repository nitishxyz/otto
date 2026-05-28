import { describe, expect, test } from 'bun:test';
import {
	catalog,
	filterModelsForAuthType,
	isModelAllowedForOAuth,
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

	test('keeps Anthropic OAuth prefix matching', () => {
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
