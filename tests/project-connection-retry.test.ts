import { afterEach, describe, expect, test } from 'bun:test';
import { setOwnerRenewalHandler } from '../packages/web-sdk/src/lib/owner-renewal.ts';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

afterEach(() => {
	setOwnerRenewalHandler(null);
	globalThis.fetch = originalFetch;
	(globalThis as typeof globalThis & { window: Window }).window =
		originalWindow;
});

describe('project connection retry', () => {
	test('reconnects the SSE transport even when owner renewal fails', async () => {
		(globalThis as typeof globalThis & { window: Window }).window = {
			location: { search: '' },
			localStorage: {
				getItem: () => null,
				setItem: () => {},
				removeItem: () => {},
			},
			OTTO_SERVER_URL: 'https://machine.ottorouter.org',
			OTTO_RUNTIME_CONTEXT: {
				projectId: 'retry-project',
				projectRoot: '/tmp/retry-project',
				serverToken: 'owner-token',
			},
		} as unknown as Window;

		let requests = 0;
		globalThis.fetch = (async (_input, init) => {
			requests += 1;
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					'abort',
					() => reject(new DOMException('Aborted', 'AbortError')),
					{ once: true },
				);
			});
		}) as typeof fetch;

		const { acquireClientEventStream, retryProjectConnection } = await import(
			'../packages/web-sdk/src/lib/event-stream.ts'
		);
		const stream = acquireClientEventStream();
		await Bun.sleep(10);
		setOwnerRenewalHandler(async () => {
			throw new Error('owner renewal failed');
		});

		await expect(retryProjectConnection()).rejects.toThrow(
			'owner renewal failed',
		);
		await Bun.sleep(10);

		expect(requests).toBe(2);
		stream.release();
	});
});
