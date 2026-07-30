import { afterEach, describe, expect, test } from 'bun:test';
import {
	isDaemonRestartAvailable,
	REMOTE_DAEMON_RESTART_CAPABILITY,
	requestDaemonRestart,
	setDaemonRestartHandler,
	type DaemonRestartRequest,
} from '../src/daemon-restart.ts';
import { createApp } from '../src/index.ts';
import { getProtocolInfo } from '../src/protocol.ts';

afterEach(() => {
	setDaemonRestartHandler(null);
});

describe('managed daemon restart capability', () => {
	test('is advertised only while a supervised handler is installed', () => {
		expect(isDaemonRestartAvailable()).toBe(false);
		expect(getProtocolInfo().capabilities).not.toContain(
			REMOTE_DAEMON_RESTART_CAPABILITY,
		);

		setDaemonRestartHandler(() => {});
		expect(isDaemonRestartAvailable()).toBe(true);
		expect(getProtocolInfo().capabilities).toContain(
			REMOTE_DAEMON_RESTART_CAPABILITY,
		);
	});

	test('fails closed without supervision and forwards validated requests once installed', () => {
		expect(() => requestDaemonRestart({})).toThrow(
			'Supervised daemon restart is unavailable',
		);

		let received: DaemonRestartRequest | null = null;
		setDaemonRestartHandler((request) => {
			received = request;
		});
		requestDaemonRestart({
			executable: '/tmp/otto-staged',
			targetVersion: '1.2.4',
		});
		expect(received).toEqual({
			executable: '/tmp/otto-staged',
			targetVersion: '1.2.4',
		});
	});

	test('restart route requires an owner session even when supervision is available', async () => {
		setDaemonRestartHandler(() => {});
		const response = await createApp().request('/v1/server/restart', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: 'Owner authorization required',
		});
	});
});
