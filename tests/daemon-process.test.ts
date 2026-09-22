import { describe, expect, it } from 'bun:test';
import { isDaemonProcessAlive } from '../apps/cli/src/runtime/daemon-process.ts';

function processStatus(stdout: string, success = true): typeof Bun.spawnSync {
	return (() => ({
		success,
		stdout: Buffer.from(stdout),
	})) as typeof Bun.spawnSync;
}

describe('daemon process liveness', () => {
	it.each(['Z', 'Z+', ' Zs\n'])(
		'recognizes zombie state %s as stopped',
		(state) => {
			expect(
				isDaemonProcessAlive(12345, {
					platform: 'darwin',
					signal: (_pid, signal) => {
						expect(signal).toBe(0);
						return true;
					},
					spawnSync: processStatus(state),
				}),
			).toBe(false);
		},
	);

	it.each(['R', 'S', 'T', 'D', ''])(
		'preserves non-zombie state %s',
		(state) => {
			expect(
				isDaemonProcessAlive(12345, {
					platform: 'linux',
					signal: () => true,
					spawnSync: processStatus(state),
				}),
			).toBe(true);
		},
	);

	it.each(['ESRCH', 'EPERM'])('handles signal probe error %s', (code) => {
		expect(
			isDaemonProcessAlive(12345, {
				signal: () => {
					throw Object.assign(new Error(code), { code });
				},
				spawnSync: (() => {
					throw new Error('must not inspect after signal error');
				}) as typeof Bun.spawnSync,
			}),
		).toBe(code !== 'ESRCH');
	});

	it('preserves liveness when process inspection fails', () => {
		for (const spawnSync of [
			processStatus('Z', false),
			(() => {
				throw new Error('ps unavailable');
			}) as typeof Bun.spawnSync,
		]) {
			expect(
				isDaemonProcessAlive(12345, {
					platform: 'linux',
					signal: () => true,
					spawnSync,
				}),
			).toBe(true);
		}
	});

	it('does not inspect Unix process state on Windows', () => {
		let inspections = 0;
		expect(
			isDaemonProcessAlive(12345, {
				platform: 'win32',
				signal: () => true,
				spawnSync: (() => {
					inspections++;
					throw new Error('ps unavailable');
				}) as typeof Bun.spawnSync,
			}),
		).toBe(true);
		expect(inspections).toBe(0);
	});
});
