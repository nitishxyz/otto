import { describe, expect, test } from 'bun:test';
import { catalog } from '../packages/sdk/src/providers/src/catalog-merged.ts';
import {
	getFastModel,
	getFastModelForAuth,
} from '../packages/sdk/src/providers/src/utils.ts';

describe('openai fast model selection', () => {
	test('uses GPT-6 Luna for API-key auth', () => {
		expect(getFastModel('openai')).toBe('gpt-6-luna');
		expect(getFastModelForAuth('openai', 'api')).toBe('gpt-6-luna');
	});

	test('uses GPT-6 Luna for ChatGPT OAuth (Codex backend)', () => {
		expect(getFastModelForAuth('openai', 'oauth')).toBe('gpt-6-luna');
	});

	test('GPT-6 Luna is available for both auth types', () => {
		expect(catalog.openai.models['gpt-6-luna']?.auth).toEqual(['api', 'oauth']);
	});
});

describe('new catalog models advertise API and OAuth', () => {
	test.each([
		['xai', 'grok-4.7'],
		['anthropic', 'claude-opus-5-5'],
		['openai', 'gpt-6-sol'],
	] as const)('%s %s', (provider, id) => {
		expect(catalog[provider].models[id]?.auth).toEqual(['api', 'oauth']);
	});
});
