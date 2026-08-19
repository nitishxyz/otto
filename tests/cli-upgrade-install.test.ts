import { describe, expect, test } from 'bun:test';
import { upgradeOttoToVersion } from '../apps/cli/src/commands/upgrade.ts';

describe('CLI upgrade installation', () => {
	test('downloads the canonical asset and installs it in the user bin directory', async () => {
		const operations: string[] = [];
		await upgradeOttoToVersion('v1.2.3', {
			platform: 'linux',
			architecture: 'arm64',
			homeDirectory: '/test/home',
			now: () => 123,
			download: async (url, destination) => {
				operations.push(`download:${url}:${destination}`);
			},
			makeDirectory: ((path) => {
				operations.push(`mkdir:${path}`);
			}) as typeof import('node:fs').mkdirSync,
			makeExecutable: ((path, mode) => {
				operations.push(`chmod:${path}:${mode}`);
			}) as typeof import('node:fs').chmodSync,
			install: ((source, destination) => {
				operations.push(`install:${source}:${destination}`);
			}) as typeof import('node:fs').renameSync,
			print: () => {},
		});

		expect(operations).toEqual([
			'mkdir:/test/home/.local/bin',
			'download:https://github.com/nitishxyz/otto/releases/download/v1.2.3/otto-linux-arm64:/test/home/.local/bin/.otto-upgrade-123',
			'chmod:/test/home/.local/bin/.otto-upgrade-123:493',
			'install:/test/home/.local/bin/.otto-upgrade-123:/test/home/.local/bin/otto',
		]);
	});

	test('uses the Windows executable name without applying chmod', async () => {
		const downloads: Array<[string, string]> = [];
		let chmodCalls = 0;
		await upgradeOttoToVersion('2.0.0', {
			platform: 'win32',
			architecture: 'x64',
			homeDirectory: 'C:/Users/test',
			now: () => 456,
			download: async (url, destination) => {
				downloads.push([url, destination]);
			},
			makeDirectory: (() => {}) as typeof import('node:fs').mkdirSync,
			makeExecutable: (() => {
				chmodCalls++;
			}) as typeof import('node:fs').chmodSync,
			install: (() => {}) as typeof import('node:fs').renameSync,
			print: () => {},
		});

		expect(downloads[0]?.[0]).toEndWith('/v2.0.0/otto-windows-x64.exe');
		expect(downloads[0]?.[1]).toEndWith('.otto-upgrade-456.exe');
		expect(chmodCalls).toBe(0);
	});

	test('rejects malformed versions and unsupported targets before installation', async () => {
		let operations = 0;
		for (const [version, platform, architecture] of [
			['1.2', 'linux', 'x64'],
			['1.2.3', 'freebsd', 'x64'],
			['1.2.3', 'linux', 'ia32'],
		]) {
			await expect(
				upgradeOttoToVersion(version, {
					platform,
					architecture,
					download: async () => {
						operations++;
					},
					makeDirectory: (() => {
						operations++;
					}) as typeof import('node:fs').mkdirSync,
				}),
			).rejects.toThrow();
		}
		expect(operations).toBe(0);
	});
});
