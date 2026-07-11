import { afterEach, describe, expect, test } from 'bun:test';
import {
	ownerRenewalDelay,
	renewOwnerSession,
	setOwnerRenewalHandler,
} from '../packages/web-sdk/src/lib/owner-renewal';
import { shouldRenewOwnerRequest } from '../packages/web-sdk/src/lib/api-client/utils';

afterEach(() => setOwnerRenewalHandler(null));

describe('owner session renewal', () => {
	test('schedules renewal ninety seconds before expiry', () => {
		expect(ownerRenewalDelay(1_000_000, 100_000)).toBe(810_000);
		expect(ownerRenewalDelay(150_000, 100_000)).toBe(0);
	});

	test('deduplicates concurrent renewal attempts', async () => {
		let calls = 0;
		let resolve!: (value: { token: string; expiresAt: number }) => void;
		setOwnerRenewalHandler(
			() =>
				new Promise((done) => {
					calls += 1;
					resolve = done;
				}),
		);
		const first = renewOwnerSession();
		const second = renewOwnerSession();
		expect(calls).toBe(1);
		resolve({ token: 'renewed', expiresAt: 1000 });
		expect(await first).toEqual(await second);
	});

	test('surfaces failed reconnect and permits a later retry', async () => {
		let calls = 0;
		setOwnerRenewalHandler(async () => {
			calls += 1;
			if (calls === 1) throw new Error('re-consent required');
			return { token: 'next', expiresAt: 2000 };
		});
		await expect(renewOwnerSession()).rejects.toThrow('re-consent required');
		expect(await renewOwnerSession()).toEqual({
			token: 'next',
			expiresAt: 2000,
		});
	});

	test('does not let completion from a replaced handler clear its pending call', async () => {
		let resolveFirst!: (value: { token: string; expiresAt: number }) => void;
		setOwnerRenewalHandler(
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
		);
		const first = renewOwnerSession();
		let secondCalls = 0;
		let resolveSecond!: (value: { token: string; expiresAt: number }) => void;
		setOwnerRenewalHandler(
			() =>
				new Promise((resolve) => {
					secondCalls += 1;
					resolveSecond = resolve;
				}),
		);
		const second = renewOwnerSession();
		resolveFirst({ token: 'first', expiresAt: 1000 });
		await first;
		expect(renewOwnerSession()).toBe(second);
		resolveSecond({ token: 'second', expiresAt: 2000 });
		await second;
		expect(secondCalls).toBe(1);
	});

	test('renews one remote owner 401 but not its retry or share/local requests', () => {
		const remote = {
			status: 401,
			shareMode: false,
			hasOwnerSession: true,
			runtimeBase: 'https://machine.example/api',
			requestUrl: 'https://machine.example/api/v1/projects',
		};
		expect(shouldRenewOwnerRequest(remote)).toBe(true);
		expect(shouldRenewOwnerRequest({ ...remote, retried: true })).toBe(false);
		expect(shouldRenewOwnerRequest({ ...remote, shareMode: true })).toBe(false);
		expect(
			shouldRenewOwnerRequest({
				...remote,
				requestUrl: 'http://127.0.0.1:47477/v1/projects',
			}),
		).toBe(false);
		expect(
			shouldRenewOwnerRequest({
				...remote,
				requestUrl: 'https://machine.example.evil/api/v1/projects',
			}),
		).toBe(false);
	});
});
