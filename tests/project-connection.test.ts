import { afterEach, describe, expect, test } from 'bun:test';
import {
	getProjectConnectionState,
	retryProjectConnection,
} from '../packages/web-sdk/src/lib/event-stream';
import { setOwnerRenewalHandler } from '../packages/web-sdk/src/lib/owner-renewal';
import { deriveProjectConnectionStatus } from '../packages/web-sdk/src/hooks/useProjectConnection';

afterEach(() => setOwnerRenewalHandler(null));

describe('project connection state', () => {
	test('reports idle when no multiplexer is active', () => {
		expect(getProjectConnectionState()).toEqual({ status: 'idle' });
	});

	test('hides the banner for healthy or fallback transports', () => {
		expect(deriveProjectConnectionStatus({ status: 'connected' })).toBe(
			'connected',
		);
		expect(deriveProjectConnectionStatus({ status: 'idle' })).toBe('connected');
		expect(deriveProjectConnectionStatus({ status: 'fallback' })).toBe(
			'connected',
		);
	});

	test('treats fresh connects as healthy and failed attempts as reconnecting', () => {
		expect(
			deriveProjectConnectionStatus({ status: 'connecting', attempt: 0 }),
		).toBe('connected');
		expect(
			deriveProjectConnectionStatus({ status: 'connecting', attempt: 1 }),
		).toBe('reconnecting');
		expect(
			deriveProjectConnectionStatus({ status: 'connecting', attempt: 2 }),
		).toBe('reconnecting');
	});

	test('reports reconnecting then disconnected as retries accumulate', () => {
		expect(
			deriveProjectConnectionStatus({
				status: 'retrying',
				attempt: 0,
				delay: 1000,
			}),
		).toBe('reconnecting');
		expect(
			deriveProjectConnectionStatus({
				status: 'retrying',
				attempt: 2,
				delay: 4000,
			}),
		).toBe('reconnecting');
		expect(
			deriveProjectConnectionStatus({
				status: 'retrying',
				attempt: 3,
				delay: 8000,
			}),
		).toBe('disconnected');
		expect(
			deriveProjectConnectionStatus({ status: 'connecting', attempt: 3 }),
		).toBe('disconnected');
	});
});

describe('retryProjectConnection', () => {
	test('renews the owner session when a renewal broker is installed', async () => {
		let calls = 0;
		setOwnerRenewalHandler(async () => {
			calls += 1;
			return { token: 'renewed', expiresAt: Date.now() + 60_000 };
		});
		await retryProjectConnection();
		expect(calls).toBe(1);
	});

	test('still reconnects transport when owner renewal is unavailable', async () => {
		setOwnerRenewalHandler(null);
		await expect(retryProjectConnection()).resolves.toBeUndefined();
	});

	test('surfaces remote renewal failures instead of retrying stale auth', async () => {
		setOwnerRenewalHandler(async () => {
			throw new Error('re-consent required');
		});
		await expect(retryProjectConnection()).rejects.toThrow(
			're-consent required',
		);
	});
});
