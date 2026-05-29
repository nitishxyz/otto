import { describe, expect, test } from 'bun:test';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { createWalletContext } from '../src/auth.ts';
import { createAccessTokenManager } from '../src/token.ts';

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

	return { keypair, wallet, walletAddress };
}

describe('createAccessTokenManager', () => {
	test('exchanges a token using signed wallet headers', async () => {
		const { keypair, wallet, walletAddress } = createSignerWallet();
		const requests: Array<{ url: string; headers: Headers }> = [];
		const manager = createAccessTokenManager({
			wallet,
			baseURL: 'https://ottorouter.test',
			fetch: async (input, init) => {
				requests.push({
					url: String(input),
					headers: new Headers(init?.headers),
				});
				return Response.json({ accessToken: 'token-1', expiresIn: 3600 });
			},
		});

		const token = await manager.getToken();
		expect(token).toBe('token-1');
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe(
			'https://ottorouter.test/v1/auth/wallet-token',
		);
		expect(requests[0]?.headers.get('x-wallet-address')).toBe(walletAddress);

		const nonce = requests[0]?.headers.get('x-wallet-nonce');
		const signature = requests[0]?.headers.get('x-wallet-signature');
		expect(nonce).toBeTruthy();
		expect(signature).toBeTruthy();

		const valid = nacl.sign.detached.verify(
			new TextEncoder().encode(nonce ?? ''),
			bs58.decode(signature ?? ''),
			keypair.publicKey.toBytes(),
		);
		expect(valid).toBe(true);
	});

	test('caches the token until refresh is needed', async () => {
		const { wallet } = createSignerWallet();
		let exchangeCount = 0;
		const manager = createAccessTokenManager({
			wallet,
			baseURL: 'https://ottorouter.test',
			fetch: async () => {
				exchangeCount++;
				return Response.json({
					accessToken: `token-${exchangeCount}`,
					expiresIn: 3600,
				});
			},
		});

		expect(await manager.getToken()).toBe('token-1');
		expect(await manager.getToken()).toBe('token-1');
		expect(exchangeCount).toBe(1);
	});

	test('refreshes an expired token', async () => {
		const { wallet } = createSignerWallet();
		let exchangeCount = 0;
		const manager = createAccessTokenManager({
			wallet,
			baseURL: 'https://ottorouter.test',
			fetch: async () => {
				exchangeCount++;
				if (exchangeCount === 1) {
					return Response.json({ accessToken: 'token-1', expiresIn: 0 });
				}
				return Response.json({ accessToken: 'token-2', expiresIn: 3600 });
			},
		});

		expect(await manager.getToken()).toBe('token-1');
		expect(await manager.getToken()).toBe('token-2');
		expect(exchangeCount).toBe(2);
	});

	test('dedupes concurrent refreshes', async () => {
		const { wallet } = createSignerWallet();
		let exchangeCount = 0;
		const manager = createAccessTokenManager({
			wallet,
			baseURL: 'https://ottorouter.test',
			fetch: async () => {
				exchangeCount++;
				await new Promise((resolve) => setTimeout(resolve, 10));
				return Response.json({ accessToken: 'shared-token', expiresIn: 3600 });
			},
		});

		const tokens = await Promise.all([
			manager.getToken(),
			manager.getToken(),
			manager.getToken(),
		]);

		expect(tokens).toEqual(['shared-token', 'shared-token', 'shared-token']);
		expect(exchangeCount).toBe(1);
	});

	test('invalidates cached tokens on demand', async () => {
		const { wallet } = createSignerWallet();
		let exchangeCount = 0;
		const manager = createAccessTokenManager({
			wallet,
			baseURL: 'https://ottorouter.test',
			fetch: async () => {
				exchangeCount++;
				return Response.json({
					accessToken: `token-${exchangeCount}`,
					expiresIn: 3600,
				});
			},
		});

		expect(await manager.getToken()).toBe('token-1');
		manager.invalidate();
		expect(await manager.getToken()).toBe('token-2');
		expect(exchangeCount).toBe(2);
	});
});
