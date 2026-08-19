import { describe, expect, test } from 'bun:test';
import { catalog } from '../packages/sdk/src/providers/src/catalog-merged.ts';
import {
	getFastModel,
	getFastModelForAuth,
} from '../packages/sdk/src/providers/src/utils.ts';

describe('kimi fast model selection', () => {
	test('prefers Kimi K2.7 Code for kimi', () => {
		expect(getFastModel('kimi')).toBe('kimi-k2.7-code');
	});

	test('uses Kimi K2.7 Code for API-key auth', () => {
		expect(getFastModelForAuth('kimi', 'api')).toBe('kimi-k2.7-code');
	});

	test('uses Kimi K2.7 Code for Kimi Code OAuth', () => {
		expect(getFastModelForAuth('kimi', 'oauth')).toBe('kimi-k2.7-code');
	});

	test('includes Kimi K2.7 Code Highspeed manual catalog metadata', () => {
		const model = catalog.kimi.models['kimi-k2.7-code-highspeed'];

		expect(model).toMatchObject({
			id: 'kimi-k2.7-code-highspeed',
			ownedBy: 'kimi',
			label: 'Kimi K2.7 Code Highspeed',
			cost: { input: 1.9, output: 8, cacheRead: 0.38 },
			limit: { context: 262_144, output: 262_144 },
		});
	});

	test('includes Kimi K3 with official pricing', () => {
		const expected = {
			id: 'kimi-k3',
			ownedBy: 'kimi',
			cost: { input: 3, output: 15, cacheRead: 0.3 },
			limit: { context: 1_048_576, output: 131_072 },
		};

		expect(catalog.kimi.models['kimi-k3']).toMatchObject(expected);
	});
});
