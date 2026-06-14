import { describe, expect, test } from 'bun:test';
import {
	getFastModel,
	getFastModelForAuth,
} from '../packages/sdk/src/providers/src/utils.ts';

describe('kimi/moonshot fast model selection', () => {
	test('prefers Kimi K2.7 Code for moonshot', () => {
		expect(getFastModel('moonshot')).toBe('kimi-k2.7-code');
	});

	test('prefers Kimi K2.7 Code for the kimi alias', () => {
		expect(getFastModel('kimi')).toBe('kimi-k2.7-code');
	});

	test('uses Kimi K2.7 Code for API-key auth', () => {
		expect(getFastModelForAuth('moonshot', 'api')).toBe('kimi-k2.7-code');
		expect(getFastModelForAuth('kimi', 'api')).toBe('kimi-k2.7-code');
	});

	test('uses Kimi K2.7 Code for Kimi Code OAuth', () => {
		expect(getFastModelForAuth('moonshot', 'oauth')).toBe('kimi-k2.7-code');
		expect(getFastModelForAuth('kimi', 'oauth')).toBe('kimi-k2.7-code');
	});
});
