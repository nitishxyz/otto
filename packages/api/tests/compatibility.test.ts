import { describe, expect, test } from 'bun:test';
import { evaluateCompatibility } from '../src/compatibility.ts';

describe('evaluateCompatibility', () => {
	test('accepts overlapping protocol ranges with required capabilities', () => {
		expect(
			evaluateCompatibility(
				{ minVersion: 1, maxVersion: 2, capabilities: ['projects.list'] },
				{ minVersion: 1, maxVersion: 1 },
				['projects.list'],
			),
		).toEqual({
			status: 'compatible',
			missingCapabilities: [],
			negotiatedProtocol: 1,
		});
	});

	test('classifies legacy and limited hosts', () => {
		expect(evaluateCompatibility(undefined).status).toBe('unknown-legacy');
		expect(
			evaluateCompatibility({ version: 1 }, undefined, [
				'remote.upgrade.stage',
			]),
		).toMatchObject({
			status: 'limited-legacy',
			missingCapabilities: ['remote.upgrade.stage'],
		});
	});

	test('distinguishes host-too-old from client-too-old', () => {
		expect(
			evaluateCompatibility(
				{ minVersion: 1, maxVersion: 1 },
				{ minVersion: 2, maxVersion: 2 },
			).status,
		).toBe('host-too-old');
		expect(
			evaluateCompatibility(
				{ minVersion: 3, maxVersion: 3 },
				{ minVersion: 2, maxVersion: 2 },
			).status,
		).toBe('client-too-old');
	});
});
