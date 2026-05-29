import { afterEach, describe, expect, test } from 'bun:test';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { createWalletContext } from '../src/auth.ts';
import { fetchBalance } from '../src/balance.ts';
import { createOttoRouterFetch } from '../src/fetch.ts';

function createSignerWallet() {
	const keypair = Keypair.generate();
	const walletAddress = keypair.publicKey.toBase58();
	const wallet = createWalletContext({
		signer: {
			walletAddress,
			signNonce: (nonce: string) => {
				const data = new TextEncoder().encode(nonce);
				const signature = nacl.sign.detached(data, keypair.secretKey);
				return bs58.encode(signature);
			},
		},
	});

	return { wallet, walletAddress };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('bearer auth request flow', () => {
	test('createOttoRouterFetch attaches bearer auth and shares one token exchange', async () => {
		const { wallet } = createSignerWallet();
		const requests: Array<{ url: string; headers: Headers }> = [];
		let tokenExchangeCount = 0;
		const ottorouterFetch = createOttoRouterFetch({
			wallet,
			baseURL: 'https://ottorouter.test',
			fetch: async (input, init) => {
				const url = String(input);
				const headers = new Headers(init?.headers);
				requests.push({ url, headers });
				if (url.endsWith('/v1/auth/wallet-token')) {
					tokenExchangeCount++;
					return Response.json({
						accessToken: 'shared-token',
						expiresIn: 3600,
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
			(request) => !request.url.endsWith('/v1/auth/wallet-token'),
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
		const { wallet } = createSignerWallet();
		let tokenExchangeCount = 0;
		let apiCount = 0;
		const ottorouterFetch = createOttoRouterFetch({
			wallet,
			baseURL: 'https://ottorouter.test',
			fetch: async (input, init) => {
				const url = String(input);
				const headers = new Headers(init?.headers);
				if (url.endsWith('/v1/auth/wallet-token')) {
					tokenExchangeCount++;
					return Response.json({
						accessToken: `token-${tokenExchangeCount}`,
						expiresIn: 3600,
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
		const { wallet, walletAddress } = createSignerWallet();
		const requests: Array<{ url: string; headers: Headers }> = [];
		globalThis.fetch = (async (input, init) => {
			const url = String(input);
			const headers = new Headers(init?.headers);
			requests.push({ url, headers });
			if (url.endsWith('/v1/auth/wallet-token')) {
				return Response.json({ accessToken: 'balance-token', expiresIn: 3600 });
			}
			return Response.json({
				wallet_address: walletAddress,
				balance_usd: 12.5,
				total_spent: 3,
				total_topups: 2,
				request_count: 9,
			});
		}) as typeof fetch;

		const balance = await fetchBalance(wallet, 'https://ottorouter.test');
		expect(balance?.walletAddress).toBe(walletAddress);
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
