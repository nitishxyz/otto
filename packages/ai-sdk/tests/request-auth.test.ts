import { afterEach, describe, expect, test } from 'bun:test';
import { fetchBalance } from '../src/balance.ts';
import { createOttoRouterFetch } from '../src/fetch.ts';
import { createOttoRouter } from '../src/ottorouter.ts';
import type { OttoRouterAuth } from '../src/types.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('request auth flow', () => {
	test('createOttoRouter accepts an API key as a static bearer credential', async () => {
		const requests: Array<{ url: string; headers: Headers }> = [];
		const ottorouter = createOttoRouter({
			auth: { apiKey: 'or_sk_test-key-1' },
			baseURL: 'https://ottorouter.test',
			fetch: async (input, init) => {
				requests.push({
					url: String(input),
					headers: new Headers(init?.headers),
				});
				return Response.json({ ok: true });
			},
		});

		const response = await ottorouter.fetch()(
			'https://ottorouter.test/v1/messages',
			{ method: 'POST' },
		);

		expect(response.status).toBe(200);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.headers.get('authorization')).toBe(
			'Bearer or_sk_test-key-1',
		);
	});

	test('does not retry a rejected API key as an OAuth token', async () => {
		let requestCount = 0;
		const ottorouterFetch = createOttoRouterFetch({
			auth: { apiKey: 'or_sk_rejected-key' },
			baseURL: 'https://ottorouter.test',
			fetch: async () => {
				requestCount++;
				return new Response('unauthorized', { status: 401 });
			},
		});

		const response = await ottorouterFetch(
			'https://ottorouter.test/v1/messages',
		);

		expect(response.status).toBe(401);
		expect(requestCount).toBe(1);
	});

	test('sends cache affinity without leaking OpenAI fields to Anthropic', async () => {
		const requests: Array<{ headers: Headers; body: Record<string, unknown> }> =
			[];
		const ottorouterFetch = createOttoRouterFetch({
			auth: { apiKey: 'or_sk_cache-key' },
			baseURL: 'https://ottorouter.test',
			cache: { promptCacheKey: 'session-123' },
			fetch: async (_input, init) => {
				requests.push({
					headers: new Headers(init?.headers),
					body: JSON.parse(String(init?.body)),
				});
				return Response.json({ ok: true });
			},
		});

		await ottorouterFetch('https://ottorouter.test/v1/messages', {
			method: 'POST',
			body: JSON.stringify({
				system: [{ type: 'text', text: 'stable prompt' }],
			}),
		});

		expect(requests[0]?.headers.get('x-session-id')).toBe('session-123');
		expect(requests[0]?.body.prompt_cache_key).toBeUndefined();
		expect(requests[0]?.body.prompt_cache_retention).toBeUndefined();
	});

	test('preserves explicit cache affinity on Chat Completions', async () => {
		const requests: Array<{ headers: Headers; body: Record<string, unknown> }> =
			[];
		const ottorouterFetch = createOttoRouterFetch({
			auth: { apiKey: 'or_sk_cache-key' },
			baseURL: 'https://ottorouter.test',
			cache: {
				promptCacheKey: 'configured-session',
				promptCacheRetention: '24h',
			},
			fetch: async (_input, init) => {
				requests.push({
					headers: new Headers(init?.headers),
					body: JSON.parse(String(init?.body)),
				});
				return Response.json({ ok: true });
			},
		});

		await ottorouterFetch('https://ottorouter.test/v1/chat/completions', {
			method: 'POST',
			headers: { 'x-session-id': 'explicit-session' },
			body: JSON.stringify({
				prompt_cache_key: 'explicit-cache-key',
				prompt_cache_retention: 'in_memory',
			}),
		});

		expect(requests[0]?.headers.get('x-session-id')).toBe('explicit-session');
		expect(requests[0]?.body.prompt_cache_key).toBe('explicit-cache-key');
		expect(requests[0]?.body.prompt_cache_retention).toBe('in_memory');
	});

	test('createOttoRouterFetch attaches bearer auth and shares one token exchange', async () => {
		const auth: OttoRouterAuth = { refreshToken: 'refresh-1' };
		const requests: Array<{ url: string; headers: Headers }> = [];
		let tokenExchangeCount = 0;
		const ottorouterFetch = createOttoRouterFetch({
			auth,
			baseURL: 'https://ottorouter.test',
			fetch: async (input, init) => {
				const url = String(input);
				const headers = new Headers(init?.headers);
				requests.push({ url, headers });
				if (url.endsWith('/api/auth/oauth2/token')) {
					tokenExchangeCount++;
					return Response.json({
						access_token: 'shared-token',
						expires_in: 3600,
					});
				}
				return Response.json({ ok: true });
			},
		});

		await Promise.all([
			ottorouterFetch('https://ottorouter.test/v1/messages', {
				method: 'POST',
			}),
			ottorouterFetch('https://ottorouter.test/v1/messages', {
				method: 'POST',
			}),
			ottorouterFetch('https://ottorouter.test/v1/messages', {
				method: 'POST',
			}),
		]);

		expect(tokenExchangeCount).toBe(1);
		const apiRequests = requests.filter(
			(request) => !request.url.endsWith('/api/auth/oauth2/token'),
		);
		expect(apiRequests).toHaveLength(3);
		for (const request of apiRequests) {
			expect(request.headers.get('authorization')).toBe('Bearer shared-token');
			expect(request.headers.get('x-wallet-address')).toBeNull();
			expect(request.headers.get('x-wallet-signature')).toBeNull();
			expect(request.headers.get('x-wallet-nonce')).toBeNull();
		}
	});

	test('shares a rotating refresh token exchange across client instances', async () => {
		const firstAuth: OttoRouterAuth = { refreshToken: 'rotating-refresh' };
		const secondAuth: OttoRouterAuth = { refreshToken: 'rotating-refresh' };
		let tokenExchangeCount = 0;
		const baseFetch = async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/api/auth/oauth2/token')) {
				tokenExchangeCount++;
				await Bun.sleep(10);
				return Response.json({
					access_token: 'shared-rotated-access',
					refresh_token: 'next-refresh',
					expires_in: 3600,
				});
			}
			return Response.json({ ok: true });
		};
		const firstFetch = createOttoRouterFetch({
			auth: firstAuth,
			baseURL: 'https://rotating.ottorouter.test',
			fetch: baseFetch,
		});
		const secondFetch = createOttoRouterFetch({
			auth: secondAuth,
			baseURL: 'https://rotating.ottorouter.test',
			fetch: baseFetch,
		});

		await Promise.all([
			firstFetch('https://rotating.ottorouter.test/v1/messages'),
			secondFetch('https://rotating.ottorouter.test/v1/messages'),
		]);

		expect(tokenExchangeCount).toBe(1);
		expect(firstAuth.refreshToken).toBe('next-refresh');
		expect(secondAuth.refreshToken).toBe('next-refresh');
	});

	test('createOttoRouterFetch refreshes and retries once on 401', async () => {
		const auth: OttoRouterAuth = { refreshToken: 'refresh-1' };
		let tokenExchangeCount = 0;
		let apiCount = 0;
		const ottorouterFetch = createOttoRouterFetch({
			auth,
			baseURL: 'https://ottorouter.test',
			fetch: async (input, init) => {
				const url = String(input);
				const headers = new Headers(init?.headers);
				if (url.endsWith('/api/auth/oauth2/token')) {
					tokenExchangeCount++;
					return Response.json({
						access_token: `token-${tokenExchangeCount}`,
						expires_in: 3600,
					});
				}
				apiCount++;
				if (headers.get('authorization') === 'Bearer token-1') {
					return new Response('unauthorized', { status: 401 });
				}
				return Response.json({ ok: true, apiCount });
			},
		});

		const response = await ottorouterFetch(
			'https://ottorouter.test/v1/messages',
			{
				method: 'POST',
			},
		);

		expect(response.status).toBe(200);
		expect(tokenExchangeCount).toBe(2);
		expect(apiCount).toBe(2);
	});

	test('fetchBalance uses bearer auth instead of wallet headers', async () => {
		const auth: OttoRouterAuth = { accessToken: 'balance-token' };
		const requests: Array<{ url: string; headers: Headers }> = [];
		globalThis.fetch = (async (input, init) => {
			const url = String(input);
			const headers = new Headers(init?.headers);
			requests.push({ url, headers });
			return Response.json({
				wallet_address: 'wallet-address-1',
				balance_usd: 12.5,
				total_spent: 3,
				total_topups: 2,
				request_count: 9,
			});
		}) as typeof fetch;

		const balance = await fetchBalance(auth, 'https://ottorouter.test');
		expect(balance?.walletAddress).toBe('wallet-address-1');
		expect(balance?.balance).toBe(12.5);

		const balanceRequest = requests.find((request) =>
			request.url.endsWith('/v1/balance'),
		);
		expect(balanceRequest?.headers.get('authorization')).toBe(
			'Bearer balance-token',
		);
		expect(balanceRequest?.headers.get('x-wallet-address')).toBeNull();
	});

	test('fetchBalance accepts an API key without an OAuth exchange', async () => {
		const requests: Array<{ url: string; headers: Headers }> = [];
		globalThis.fetch = (async (input, init) => {
			requests.push({
				url: String(input),
				headers: new Headers(init?.headers),
			});
			return Response.json({
				account_id: 'account-1',
				balance_usd: 7.5,
				total_spent: 1,
				total_topups: 0,
				request_count: 2,
			});
		}) as typeof fetch;

		const balance = await fetchBalance(
			{ apiKey: 'or_sk_balance-key' },
			'https://ottorouter.test',
		);

		expect(balance?.walletAddress).toBe('account-1');
		expect(balance?.balance).toBe(7.5);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.headers.get('authorization')).toBe(
			'Bearer or_sk_balance-key',
		);
	});

	test('fetchBalance does not retry a rejected API key', async () => {
		let requestCount = 0;
		globalThis.fetch = (async () => {
			requestCount++;
			return new Response('unauthorized', { status: 401 });
		}) as typeof fetch;

		const balance = await fetchBalance(
			{ apiKey: 'or_sk_rejected-balance-key' },
			'https://ottorouter.test',
		);

		expect(balance).toBeNull();
		expect(requestCount).toBe(1);
	});
});
