import { describe, expect, test } from 'bun:test';
import { ExpiringSessionStore } from '../packages/server/src/routes/auth/expiring-session-store.ts';
import {
	pollDeviceFlow,
	startDeviceFlow,
	type DeviceFlowAdapter,
} from '../packages/server/src/routes/auth/oauth/device-flow.ts';

describe('ExpiringSessionStore', () => {
	test('supports get, take, delete, and fake-clock expiry', () => {
		let now = 1_000;
		const removed: string[] = [];
		const store = new ExpiringSessionStore<{ value: string }>({
			ttlMs: 100,
			now: () => now,
			onDelete: (value, reason) => removed.push(`${value.value}:${reason}`),
		});

		store.create('take', { value: 'a' });
		expect(store.get('take')).toEqual({ value: 'a' });
		expect(store.take('take')).toEqual({ value: 'a' });
		expect(store.get('take')).toBeUndefined();

		store.create('delete', { value: 'b' });
		expect(store.delete('delete')).toBe(true);

		store.create('expired', { value: 'c' });
		now += 100;
		expect(store.sweep()).toBe(1);
		expect(store.get('expired')).toBeUndefined();
		expect(removed).toEqual(['a:take', 'b:delete', 'c:expired']);
	});
});

describe('device flow orchestration', () => {
	test('preserves provider start metadata and pending-to-complete transition', async () => {
		const store = new ExpiringSessionStore<{ pollCount: number }>({
			ttlMs: 1_000,
		});
		const completed: string[] = [];
		const adapter: DeviceFlowAdapter<{ pollCount: number }, string> = {
			async start() {
				return {
					session: { pollCount: 0 },
					userCode: 'ABCD',
					verificationUri: 'https://provider.example/verify',
					interval: 7,
				};
			},
			async poll(session) {
				session.pollCount++;
				return session.pollCount === 1
					? { status: 'pending' }
					: { status: 'complete', value: 'tokens' };
			},
			async complete(value) {
				completed.push(value);
			},
		};

		const started = await startDeviceFlow(
			store,
			adapter,
			() => 'provider-session',
		);
		expect(started).toEqual({
			sessionId: 'provider-session',
			userCode: 'ABCD',
			verificationUri: 'https://provider.example/verify',
			interval: 7,
		});
		expect(await pollDeviceFlow(store, adapter, started.sessionId)).toEqual({
			status: 'pending',
		});
		expect(store.get(started.sessionId)).toBeDefined();
		expect(await pollDeviceFlow(store, adapter, started.sessionId)).toEqual({
			status: 'complete',
		});
		expect(completed).toEqual(['tokens']);
		expect(store.get(started.sessionId)).toBeUndefined();
	});

	test('cleans up provider terminal errors', async () => {
		const store = new ExpiringSessionStore<object>({ ttlMs: 1_000 });
		const adapter: DeviceFlowAdapter<object, never> = {
			async start() {
				return {
					session: {},
					userCode: 'ERR',
					verificationUri: 'https://provider.example/verify',
					interval: 3,
				};
			},
			async poll() {
				return { status: 'error', error: 'access denied' };
			},
			async complete() {},
		};

		await startDeviceFlow(store, adapter, () => 'error-session');
		expect(await pollDeviceFlow(store, adapter, 'error-session')).toEqual({
			status: 'error',
			error: 'access denied',
		});
		expect(store.get('error-session')).toBeUndefined();
	});
});
