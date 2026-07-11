import { describe, expect, test } from 'bun:test';
import {
	assertUpgradeTarget,
	compareReleaseVersions,
	stageDaemonUpgrade,
} from '../src/upgrade.ts';

describe('remote upgrade policy', () => {
	test('allows only a strictly newer target', () => {
		expect(() => assertUpgradeTarget('1.2.3', '1.2.4')).not.toThrow();
		expect(() => assertUpgradeTarget('1.2.3', '1.2.3')).toThrow(
			'Target must be newer',
		);
		expect(() => assertUpgradeTarget('2.0.0', '1.9.9')).toThrow(
			'Target must be newer',
		);
	});

	test('rejects unknown versions, tags, prereleases, and URLs', () => {
		expect(() => assertUpgradeTarget(null, '1.2.3')).toThrow('unknown');
		for (const target of [
			'v1.2.4',
			'1.2.4-beta',
			'https://attacker.test/bin',
		]) {
			expect(() => assertUpgradeTarget('1.2.3', target)).toThrow(
				'numeric major.minor.patch',
			);
		}
	});

	test('compares all semantic version components numerically', () => {
		expect(compareReleaseVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
		expect(compareReleaseVersions('1.0.0', '2.0.0')).toBeLessThan(0);
	});

	test('rejects malformed, same, and downgrade targets before network access', async () => {
		let requests = 0;
		const fetcher = (() => {
			requests++;
			throw new Error('must not fetch');
		}) as typeof fetch;

		for (const target of ['https://attacker.test/bin', '1.2.3', '1.2.2']) {
			await expect(
				stageDaemonUpgrade('1.2.3', target, fetcher),
			).rejects.toThrow();
		}
		expect(requests).toBe(0);
	});
});
