import { Keypair } from '@solana/web3.js';
import {
	fetchOttoRouterBalance,
	getAuth,
	getPublicKeyFromPrivate,
	loadConfig,
} from '@ottocode/sdk';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const OTTOROUTER_BASE_URL =
	process.env.OTTOROUTER_BASE_URL || 'https://api.ottorouter.org';

export function getOttoRouterBaseUrl(): string {
	return OTTOROUTER_BASE_URL.endsWith('/')
		? OTTOROUTER_BASE_URL.slice(0, -1)
		: OTTOROUTER_BASE_URL;
}

export async function getOttoRouterPrivateKey(): Promise<string | null> {
	if (process.env.OTTOROUTER_PRIVATE_KEY) {
		return process.env.OTTOROUTER_PRIVATE_KEY;
	}

	try {
		const cfg = await loadConfig(process.cwd());
		const auth = await getAuth('ottorouter', cfg.projectRoot);
		if (auth?.type === 'wallet' && auth.secret) {
			return auth.secret;
		}
	} catch {}

	return null;
}

function signNonce(nonce: string, privateKeyBytes: Uint8Array): string {
	const data = new TextEncoder().encode(nonce);
	const signature = nacl.sign.detached(data, privateKeyBytes);
	return bs58.encode(signature);
}

export function buildWalletHeaders(privateKey: string): Record<string, string> {
	const privateKeyBytes = bs58.decode(privateKey);
	const keypair = Keypair.fromSecretKey(privateKeyBytes);
	const walletAddress = keypair.publicKey.toBase58();
	const nonce = Date.now().toString();
	const signature = signNonce(nonce, privateKeyBytes);
	return {
		'x-wallet-address': walletAddress,
		'x-wallet-nonce': nonce,
		'x-wallet-signature': signature,
	};
}

export async function getOttoRouterBalance() {
	const privateKey = await getOttoRouterPrivateKey();
	if (!privateKey) {
		return {
			ok: false as const,
			body: { error: 'OttoRouter wallet not configured' },
			status: 401 as const,
		};
	}

	const balance = await fetchOttoRouterBalance({ privateKey });
	if (!balance) {
		return {
			ok: false as const,
			body: { error: 'Failed to fetch balance from OttoRouter' },
			status: 502 as const,
		};
	}

	return { ok: true as const, body: balance };
}

export async function getOttoRouterWalletInfo() {
	const privateKey = await getOttoRouterPrivateKey();
	if (!privateKey) {
		return {
			configured: false,
			error: 'OttoRouter wallet not configured',
		};
	}

	const publicKey = getPublicKeyFromPrivate(privateKey);
	if (!publicKey) {
		return { configured: false, error: 'Invalid private key' };
	}

	return { configured: true, publicKey };
}
