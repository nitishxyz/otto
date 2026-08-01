import { describe, expect, test } from 'bun:test';
import {
	DESKTOP_DAEMON_START_RETRIES,
	ensureDesktopDaemonReady,
} from '../src/lib/daemon-startup';
import type { ServerInfo } from '../src/lib/tauri-bridge';

const daemon: ServerInfo = {
	pid: 42,
	port: 47477,
	projectPath: '/tmp/otto',
	projectId: '',
	url: 'http://127.0.0.1:47477',
	token: 'token',
	cliPath: '/tmp/otto/bin/otto',
	cliVersion: '1.2.3',
};

describe('desktop daemon startup', () => {
	test('waits for a transient restart to become ready', async () => {
		let attempts = 0;
		let activeCalls = 0;
		let maxActiveCalls = 0;

		const result = await ensureDesktopDaemonReady(async () => {
			attempts += 1;
			activeCalls += 1;
			maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
			await Promise.resolve();
			activeCalls -= 1;
			if (attempts < 3) throw new Error('daemon is still restarting');
			return daemon;
		}, 0);

		expect(result).toBe(daemon);
		expect(attempts).toBe(3);
		expect(maxActiveCalls).toBe(1);
	});

	test('surfaces the last failure after three automatic retries', async () => {
		let attempts = 0;
		const failure = new Error('daemon did not become ready');

		await expect(
			ensureDesktopDaemonReady(async () => {
				attempts += 1;
				throw failure;
			}, 0),
		).rejects.toBe(failure);
		expect(attempts).toBe(DESKTOP_DAEMON_START_RETRIES + 1);
	});
});
