import { afterEach, describe, expect, test } from 'bun:test';
import { fetchBalance } from '../src/balance.ts';
import { createOttoRouterFetch } from '../src/fetch.ts';
import type { OttoRouterAuth } from '../src/types.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('bearer auth request flow', () => {
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
});
