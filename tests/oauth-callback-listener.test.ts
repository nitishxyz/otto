import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import {
	startOAuthCallbackProxy,
	startOAuthLoopbackCallback,
	stopOAuthCallbackProxy,
	type OAuthLoopbackCallbackInput,
} from '../packages/server/src/routes/oauth-callback-proxy.ts';

const listenerIds: string[] = [];

afterEach(() => {
	for (const listenerId of listenerIds.splice(0)) {
		stopOAuthCallbackProxy(listenerId);
	}
});

async function listen(server: Server, port = 0): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Missing port');
	return address.port;
}

async function close(server: Server): Promise<void> {
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function callbackUrl(): Promise<string> {
	const probe = createServer();
	const port = await listen(probe);
	await close(probe);
	return `http://127.0.0.1:${port}/callback`;
}

async function start(input: OAuthLoopbackCallbackInput): Promise<string> {
	const { listenerId } = await startOAuthLoopbackCallback(input);
	listenerIds.push(listenerId);
	return listenerId;
}

async function request(url: string, method = 'GET'): Promise<number> {
	const response = await fetch(url, {
		method,
		headers: { Connection: 'close' },
	});
	await response.text();
	return response.status;
}

const defaults = { successMessage: 'Done', complete: async () => {} };

describe('OAuth loopback listener lifecycle', () => {
	test('unrelated paths, methods and invalid states do not consume callbacks', async () => {
		const url = await callbackUrl();
		const results: unknown[] = [];
		await start({
			...defaults,
			callbackUrl: url,
			expectedState: 'expected',
			complete: async (result) => {
				results.push(result);
			},
		});

		expect(await request(new URL('/favicon.ico', url).href)).toBe(404);
		expect(await request(`${url}?state=expected`, 'POST')).toBe(405);
		expect(await request(`${url}?code=ignored`)).toBe(404);
		expect(await request(`${url}?state=wrong&code=ignored`)).toBe(404);
		// Wait beyond the old unconditional shutdown delay.
		await Bun.sleep(150);
		expect(results).toEqual([]);
		expect(await request(`${url}?state=expected&code=accepted`)).toBe(200);
		expect(results).toEqual([{ code: 'accepted', state: 'expected' }]);
	});

	test('same path and state replace the handler without stale ID cancellation', async () => {
		const url = await callbackUrl();
		const called: string[] = [];
		const oldId = await start({
			...defaults,
			callbackUrl: url,
			expectedState: 'same',
			complete: async () => {
				called.push('old');
			},
		});
		const newId = await start({
			...defaults,
			callbackUrl: url,
			expectedState: 'same',
			complete: async () => {
				called.push('new');
			},
		});
		expect(newId).not.toBe(oldId);
		stopOAuthCallbackProxy(oldId);
		expect(await request(`${url}?state=same`)).toBe(200);
		expect(called).toEqual(['new']);
	});

	test('concurrent states share a port and are each consumed once', async () => {
		const url = await callbackUrl();
		const called: string[] = [];
		await Promise.all(
			['first', 'second'].map((state) =>
				start({
					...defaults,
					callbackUrl: url,
					expectedState: state,
					complete: async () => {
						called.push(state);
					},
				}),
			),
		);
		expect(await request(`${url}?state=first`)).toBe(200);
		expect(await request(`${url}?state=first`)).toBe(404);
		expect(await request(`${url}?state=second`)).toBe(200);
		expect(called).toEqual(['first', 'second']);

		// Once empty, the listener releases its fixed port for a new flow.
		await start({ ...defaults, callbackUrl: url, expectedState: 'third' });
		expect(await request(`${url}?state=third`)).toBe(200);
	});

	test('different paths coexist and stopping one ID leaves the other active', async () => {
		const url = await callbackUrl();
		const otherUrl = new URL('/other', url).href;
		const first = await start({
			...defaults,
			callbackUrl: url,
			expectedState: 'same',
		});
		await start({
			...defaults,
			callbackUrl: otherUrl,
			expectedState: 'same',
		});
		stopOAuthCallbackProxy(first);
		expect(await request(`${url}?state=same`)).toBe(404);
		expect(await request(`${otherUrl}?state=same`)).toBe(200);
	});

	test('completion failures still consume only the matching registration', async () => {
		const url = await callbackUrl();
		await start({
			...defaults,
			callbackUrl: url,
			expectedState: 'failure',
			complete: async () => {
				throw new Error('Rejected');
			},
		});
		await start({ ...defaults, callbackUrl: url, expectedState: 'success' });
		expect(await request(`${url}?state=failure`)).toBe(400);
		expect(await request(`${url}?state=failure`)).toBe(404);
		expect(await request(`${url}?state=success`)).toBe(200);
	});

	test('occupied ports reject before publishing an authorization URL and allow retries', async () => {
		const occupied = createServer();
		const port = await listen(occupied);
		const url = `http://127.0.0.1:${port}/callback`;
		let opened = false;
		try {
			await expect(
				startOAuthCallbackProxy(
					{
						authorizationUrl: 'https://auth.example/authorize?state=expected',
						callbackUrl: url,
						remoteBaseUrl: 'http://127.0.0.1:9999',
						remoteFlowId: 'flow',
						remoteToken: 'token',
					},
					async () => {
						opened = true;
						return true;
					},
				),
			).rejects.toThrow();
			expect(opened).toBe(false);
		} finally {
			await close(occupied);
		}
		await start({ ...defaults, callbackUrl: url, expectedState: 'retry' });
		expect(await request(`${url}?state=retry`)).toBe(200);
	});

	test('proxies derive expected state from the authorization URL', async () => {
		const url = await callbackUrl();
		const relayed: unknown[] = [];
		const remote = Bun.serve({
			port: 0,
			async fetch(req) {
				relayed.push(await req.json());
				return Response.json({ ok: true });
			},
		});
		try {
			const { proxyId } = await startOAuthCallbackProxy(
				{
					authorizationUrl: 'https://auth.example/authorize?state=proxy-state',
					callbackUrl: url,
					remoteBaseUrl: `http://127.0.0.1:${remote.port}`,
					remoteFlowId: 'flow',
					remoteToken: 'token',
				},
				async () => false,
			);
			listenerIds.push(proxyId);
			expect(await request(`${url}?state=wrong`)).toBe(404);
			expect(relayed).toEqual([]);
			expect(await request(`${url}?state=proxy-state&code=code`)).toBe(200);
			expect(relayed).toEqual([{ state: 'proxy-state', code: 'code' }]);
		} finally {
			remote.stop(true);
		}
	});
});
