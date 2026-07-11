import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	ProviderStreamIdleTimeoutError,
	createResilientFetch,
	isNonReplayableRequestBody,
	isProviderStreamIdleTimeoutError,
	resilientFetch,
	withStreamIdleTimeout,
} from '../packages/sdk/src/providers/src/resilient-fetch.ts';

const ENV_KEYS = [
	'OTTO_PROVIDER_REQUEST_TIMEOUT_MS',
	'OTTO_PROVIDER_REQUEST_MAX_RETRIES',
	'OTTO_PROVIDER_REQUEST_RETRY_DELAY_MS',
	'OTTO_PROVIDER_STREAM_IDLE_TIMEOUT_MS',
] as const;

describe('resilient-fetch', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		for (const key of ENV_KEYS) {
			delete process.env[key];
		}
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		for (const key of ENV_KEYS) {
			delete process.env[key];
		}
	});

	test('retries pre-header timeouts then returns the response', async () => {
		process.env.OTTO_PROVIDER_REQUEST_TIMEOUT_MS = '1';
		process.env.OTTO_PROVIDER_REQUEST_MAX_RETRIES = '2';
		process.env.OTTO_PROVIDER_REQUEST_RETRY_DELAY_MS = '1';

		let callCount = 0;
		globalThis.fetch = (async (_input, init) => {
			callCount += 1;
			if (callCount < 3) {
				return await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => reject(init.signal?.reason ?? new Error('aborted')),
						{ once: true },
					);
				});
			}
			return new Response('ok', { status: 200 });
		}) as typeof fetch;

		const response = await resilientFetch('https://example.test/v1', {
			method: 'POST',
			body: JSON.stringify({ hello: 'world' }),
		});

		expect(await response.text()).toBe('ok');
		expect(callCount).toBe(3);
	});

	test('does not retry when parent signal aborts', async () => {
		process.env.OTTO_PROVIDER_REQUEST_TIMEOUT_MS = '50';
		process.env.OTTO_PROVIDER_REQUEST_MAX_RETRIES = '3';
		process.env.OTTO_PROVIDER_REQUEST_RETRY_DELAY_MS = '1';

		let callCount = 0;
		const controller = new AbortController();

		globalThis.fetch = (async (_input, init) => {
			callCount += 1;
			return await new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					'abort',
					() => reject(init.signal?.reason ?? new Error('aborted')),
					{ once: true },
				);
			});
		}) as typeof fetch;

		const pending = resilientFetch('https://example.test/v1', {
			signal: controller.signal,
		});

		// Abort after the first attempt has started.
		await Promise.resolve();
		controller.abort(new Error('parent-cancel'));

		await expect(pending).rejects.toThrow('parent-cancel');
		expect(callCount).toBe(1);
	});

	test('abort-aware backoff stops retry delay on parent abort', async () => {
		process.env.OTTO_PROVIDER_REQUEST_TIMEOUT_MS = '1';
		process.env.OTTO_PROVIDER_REQUEST_MAX_RETRIES = '5';
		process.env.OTTO_PROVIDER_REQUEST_RETRY_DELAY_MS = '30000';

		let callCount = 0;
		const controller = new AbortController();

		globalThis.fetch = (async (_input, init) => {
			callCount += 1;
			return await new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					'abort',
					() => reject(init.signal?.reason ?? new Error('aborted')),
					{ once: true },
				);
			});
		}) as typeof fetch;

		const pending = resilientFetch('https://example.test/v1', {
			method: 'POST',
			body: '{}',
			signal: controller.signal,
		});

		// Wait until first attempt times out and backoff begins.
		await Bun.sleep(20);
		controller.abort(new Error('abort-during-backoff'));

		await expect(pending).rejects.toThrow('abort-during-backoff');
		expect(callCount).toBe(1);
	});

	test('does not retry non-replayable ReadableStream bodies', async () => {
		process.env.OTTO_PROVIDER_REQUEST_TIMEOUT_MS = '1';
		process.env.OTTO_PROVIDER_REQUEST_MAX_RETRIES = '5';
		process.env.OTTO_PROVIDER_REQUEST_RETRY_DELAY_MS = '1';

		let callCount = 0;
		globalThis.fetch = (async (_input, init) => {
			callCount += 1;
			return await new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					'abort',
					() => reject(init.signal?.reason ?? new Error('aborted')),
					{ once: true },
				);
			});
		}) as typeof fetch;

		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('partial'));
				controller.close();
			},
		});

		expect(
			isNonReplayableRequestBody('https://example.test/v1', { body }),
		).toBe(true);

		await expect(
			resilientFetch('https://example.test/v1', {
				method: 'POST',
				body,
			}),
		).rejects.toBeDefined();

		expect(callCount).toBe(1);
	});

	test('applies stream idle timeout only for text/event-stream', async () => {
		process.env.OTTO_PROVIDER_STREAM_IDLE_TIMEOUT_MS = '5';

		globalThis.fetch = (async () =>
			new Response(
				new ReadableStream<Uint8Array>({
					start() {
						// never enqueues
					},
				}),
				{ headers: { 'content-type': 'text/event-stream' } },
			)) as typeof fetch;

		const response = await resilientFetch('https://example.test/stream', {
			method: 'POST',
			body: '{}',
		});

		try {
			await response.text();
			expect.unreachable('expected stream idle timeout');
		} catch (error) {
			expect(isProviderStreamIdleTimeoutError(error)).toBe(true);
			expect(error).toBeInstanceOf(ProviderStreamIdleTimeoutError);
		}
	});

	test('does not idle-timeout non-SSE responses', async () => {
		process.env.OTTO_PROVIDER_STREAM_IDLE_TIMEOUT_MS = '1';

		globalThis.fetch = (async () =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						// Delayed chunk — would trip idle timeout if watchdog applied.
						setTimeout(() => {
							controller.enqueue(new TextEncoder().encode('late'));
							controller.close();
						}, 20);
					},
				}),
				{ headers: { 'content-type': 'application/json' } },
			)) as typeof fetch;

		const response = await resilientFetch('https://example.test/json');
		expect(await response.text()).toBe('late');
	});

	test('resets idle timeout on raw chunks including heartbeats', async () => {
		process.env.OTTO_PROVIDER_STREAM_IDLE_TIMEOUT_MS = '40';

		globalThis.fetch = (async () =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						const encoder = new TextEncoder();
						// SSE comment heartbeats only — no data events.
						controller.enqueue(encoder.encode(': ping\n\n'));
						setTimeout(() => {
							controller.enqueue(encoder.encode(': ping\n\n'));
						}, 25);
						setTimeout(() => {
							controller.enqueue(encoder.encode('data: done\n\n'));
							controller.close();
						}, 50);
					},
				}),
				{ headers: { 'content-type': 'text/event-stream' } },
			)) as typeof fetch;

		const response = await resilientFetch('https://example.test/stream');
		const text = await response.text();
		expect(text).toContain('data: done');
	});

	test('preserves response status and headers through idle wrapper', async () => {
		const base = new Response('data: ok\n\n', {
			status: 201,
			statusText: 'Created',
			headers: {
				'content-type': 'text/event-stream',
				'x-request-id': 'req_123',
			},
		});

		const wrapped = withStreamIdleTimeout(base, 30_000);
		expect(wrapped.status).toBe(201);
		expect(wrapped.statusText).toBe('Created');
		expect(wrapped.headers.get('content-type')).toBe('text/event-stream');
		expect(wrapped.headers.get('x-request-id')).toBe('req_123');
		expect(await wrapped.text()).toBe('data: ok\n\n');
	});

	test('isProviderStreamIdleTimeoutError survives nested wrapping', () => {
		const root = new ProviderStreamIdleTimeoutError(30_000);
		const wrapped = new Error('AI_APICallError', { cause: root });
		const doubleWrapped = {
			name: 'APICallError',
			message: 'stream failed',
			cause: wrapped,
		};

		expect(isProviderStreamIdleTimeoutError(root)).toBe(true);
		expect(isProviderStreamIdleTimeoutError(wrapped)).toBe(true);
		expect(isProviderStreamIdleTimeoutError(doubleWrapped)).toBe(true);
		expect(
			isProviderStreamIdleTimeoutError(
				new Error('Provider stream idle timeout after 1000ms'),
			),
		).toBe(true);
		expect(isProviderStreamIdleTimeoutError(new Error('other'))).toBe(false);
	});

	test('createResilientFetch honors explicit options over env', async () => {
		process.env.OTTO_PROVIDER_REQUEST_TIMEOUT_MS = '1';
		process.env.OTTO_PROVIDER_REQUEST_MAX_RETRIES = '5';

		let callCount = 0;
		const customFetch: typeof fetch = (async () => {
			callCount += 1;
			return new Response('ok');
		}) as typeof fetch;

		const fetchFn = createResilientFetch({
			requestTimeoutMs: 5_000,
			maxRetries: 0,
			retryDelayMs: 1,
			streamIdleTimeoutMs: 30_000,
			fetch: customFetch,
		});

		const response = await fetchFn('https://example.test/v1');
		expect(await response.text()).toBe('ok');
		expect(callCount).toBe(1);
	});

	test('retries network failures before headers', async () => {
		process.env.OTTO_PROVIDER_REQUEST_MAX_RETRIES = '2';
		process.env.OTTO_PROVIDER_REQUEST_RETRY_DELAY_MS = '1';
		process.env.OTTO_PROVIDER_REQUEST_TIMEOUT_MS = '5000';

		let callCount = 0;
		globalThis.fetch = (async () => {
			callCount += 1;
			if (callCount < 2) {
				throw new TypeError('fetch failed');
			}
			return new Response('recovered');
		}) as typeof fetch;

		const response = await resilientFetch('https://example.test/v1');
		expect(await response.text()).toBe('recovered');
		expect(callCount).toBe(2);
	});
});
