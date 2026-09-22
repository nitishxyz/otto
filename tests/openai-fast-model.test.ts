import { describe, expect, test } from 'bun:test';
import {
	getFastModel,
	getFastModelForAuth,
} from '../packages/sdk/src/providers/src/utils.ts';

describe('openai fast model selection', () => {
	test('uses GPT-5.6 Luna for ChatGPT OAuth (Codex backend)', () => {
		expect(getFastModelForAuth('openai', 'oauth')).toBe('gpt-5.6-luna');
	});

	test('keeps the API-key fast model unchanged', () => {
		expect(getFastModelForAuth('openai', 'api')).toBe(getFastModel('openai'));
		expect(getFastModel('openai')).not.toBe('gpt-5.6-luna');
	});
});
