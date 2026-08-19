import { describe, expect, test } from 'bun:test';
import {
	abortableDelay,
	parseIntegerSetting,
	retry,
} from '../packages/sdk/src/runtime/retry.ts';

describe('runtime retry primitives', () => {
	test('parses integer settings with explicit minimums', () => {
		expect(parseIntegerSetting(undefined, 3, { min: 0 })).toBe(3);
		expect(parseIntegerSetting('0', 3, { min: 0 })).toBe(0);
		expect(parseIntegerSetting('-1', 3, { min: 0 })).toBe(3);
		expect(parseIntegerSetting('invalid', 3, { min: 0 })).toBe(3);
	});

	test('supports zero retries and zero delay', async () => {
		let zeroRetryAttempts = 0;
		await expect(
			retry(
				async () => {
					zeroRetryAttempts += 1;
					throw new Error('failed');
				},
				{ maxRetries: 0, delayMs: 0 },
			),
		).rejects.toThrow('failed');
		expect(zeroRetryAttempts).toBe(1);

		let delayedAttempts = 0;
		const result = await retry(
			async () => {
				delayedAttempts += 1;
				if (delayedAttempts === 1) throw new Error('retry');
				return 'ok';
			},
			{ maxRetries: 1, delayMs: 0 },
		);
		expect(result).toBe('ok');
		expect(delayedAttempts).toBe(2);
	});

	test('aborts during backoff', async () => {
		const controller = new AbortController();
		const pending = retry(async () => Promise.reject(new Error('retry')), {
			maxRetries: 3,
			delayMs: 30_000,
			signal: controller.signal,
		});
		await Promise.resolve();
		controller.abort(new Error('cancel-backoff'));
		await expect(pending).rejects.toThrow('cancel-backoff');
	});

	test('distinguishes terminal and retryable token errors', async () => {
		let terminalAttempts = 0;
		await expect(
			retry(
				async () => {
					terminalAttempts += 1;
					throw new Error('refresh token rejected');
				},
				{
					maxRetries: 2,
					shouldRetry: (error) =>
						!(
							error instanceof Error &&
							error.message.includes('refresh token rejected')
						),
				},
			),
		).rejects.toThrow('refresh token rejected');
		expect(terminalAttempts).toBe(1);

		let retryableAttempts = 0;
		await retry(
			async () => {
				retryableAttempts += 1;
				if (retryableAttempts < 3)
					throw new Error('token endpoint unavailable');
			},
			{ maxRetries: 2 },
		);
		expect(retryableAttempts).toBe(3);
	});

	test('zero delay still observes an already-aborted signal', async () => {
		const controller = new AbortController();
		controller.abort(new Error('already-cancelled'));
		await expect(abortableDelay(0, controller.signal)).rejects.toThrow(
			'already-cancelled',
		);
	});
});
