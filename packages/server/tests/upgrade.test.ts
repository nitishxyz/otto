import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	assertUpgradeTarget,
	compareReleaseVersions,
	resolveStagedDaemonUpgrade,
	stageDaemonUpgrade,
} from '../src/upgrade.ts';

const originalOttoHome = process.env.OTTO_HOME;
const tempRoots: string[] = [];

afterEach(async () => {
	if (originalOttoHome === undefined) delete process.env.OTTO_HOME;
	else process.env.OTTO_HOME = originalOttoHome;
	for (const root of tempRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

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

	test('activates only a previously staged official release binary', async () => {
		const root = await mkdtemp(join(tmpdir(), 'otto-upgrade-test-'));
		tempRoots.push(root);
		process.env.OTTO_HOME = root;
		const os = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[
			platform()
		];
		const cpu = { x64: 'x64', arm64: 'arm64' }[arch()];
		if (!os || !cpu) throw new Error('Unsupported test platform');
		const stagedPath = join(
			root,
			'upgrades',
			'1.2.4',
			`otto-${os}-${cpu}${platform() === 'win32' ? '.exe' : ''}`,
		);
		await mkdir(join(root, 'upgrades', '1.2.4'), { recursive: true });
		await Bun.write(stagedPath, 'official-binary');
		if (platform() !== 'win32') await chmod(stagedPath, 0o755);
		expect(await resolveStagedDaemonUpgrade('1.2.3', '1.2.4')).toBe(stagedPath);
		await expect(resolveStagedDaemonUpgrade('1.2.3', '1.2.5')).rejects.toThrow(
			'not staged',
		);
	});
});
