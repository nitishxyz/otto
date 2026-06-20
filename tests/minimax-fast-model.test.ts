import { describe, expect, test } from 'bun:test';
import { catalog } from '../packages/sdk/src/providers/src/catalog-merged.ts';
import {
	getFastModel,
	getFastModelForAuth,
} from '../packages/sdk/src/providers/src/utils.ts';

describe('minimax fast model selection', () => {
	test('prefers MiniMax-M2.7 for minimax', () => {
		expect(getFastModel('minimax')).toBe('MiniMax-M2.7');
	});

	test('uses MiniMax-M2.7 for API-key auth', () => {
		expect(getFastModelForAuth('minimax', 'api')).toBe('MiniMax-M2.7');
	});

	test('MiniMax-M2.7 manual catalog metadata', () => {
		const model = catalog.minimax.models['MiniMax-M2.7'];

		expect(model).toMatchObject({
			id: 'MiniMax-M2.7',
			ownedBy: 'minimax',
			label: 'MiniMax-M2.7',
			cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
			limit: { context: 204800, output: 131072 },
		});
	});
});
