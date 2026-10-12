import {
	createOttoRouter,
	fetchBalance,
	fetchWalletUsdcBalance,
	getPublicKeyFromPrivate as _getPublicKeyFromPrivate,
	type OttoRouterConfig,
	type PaymentCallbacks,
	type BalanceUpdate,
	type BalanceResponse,
	type WalletUsdcBalance,
	type OttoRouterAuth as _OttoRouterAuth,
	type OttoRouterInstance,
} from '@ottorouter/ai-sdk';
import type { LanguageModelV3Middleware } from '@ai-sdk/provider';

export type OttoRouterBalanceUpdate = BalanceUpdate;

export type OttoRouterPaymentCallbacks = PaymentCallbacks;

export type OttoRouterProviderOptions = {
	fetch?: typeof fetch;
	baseURL?: string;
	rpcURL?: string;
	network?: string;
	maxRequestAttempts?: number;
	maxPaymentAttempts?: number;
	callbacks?: OttoRouterPaymentCallbacks;
	providerNpm?: string;
	promptCacheKey?: string;
	promptCacheRetention?: 'in_memory' | '24h';
	topupApprovalMode?: 'auto' | 'approval';
	autoPayThresholdUsd?: number;
	middleware?: LanguageModelV3Middleware | LanguageModelV3Middleware[];
};

export type OttoRouterAuth = _OttoRouterAuth;

export type OttoRouterBalanceResponse = BalanceResponse;

export type SolanaUsdcBalanceResponse = WalletUsdcBalance;

export function createOttoRouterFetch(
	auth: OttoRouterAuth,
	options: OttoRouterProviderOptions = {},
): typeof fetch {
	const ottorouter = createOttoRouter(buildOttoRouterConfig(auth, options));
	return ottorouter.fetch() as typeof fetch;
}

export function createOttoRouterModel(
	model: string,
	auth: OttoRouterAuth,
	options: OttoRouterProviderOptions = {},
) {
	const ottorouter = createOttoRouter(buildOttoRouterConfig(auth, options));
	return ottorouter.model(model);
}

function buildOttoRouterConfig(
	auth: OttoRouterAuth,
	options: OttoRouterProviderOptions = {},
): OttoRouterConfig {
	return {
		auth,
		fetch: options.fetch,
		baseURL: options.baseURL,
		rpcURL: options.rpcURL,
		callbacks: options.callbacks,
		middleware: options.middleware,
		cache: {
			promptCacheKey: options.promptCacheKey,
			promptCacheRetention: options.promptCacheRetention,
		},
		payment: {
			topupApprovalMode: options.topupApprovalMode,
			autoPayThresholdUsd: options.autoPayThresholdUsd,
			maxRequestAttempts: options.maxRequestAttempts,
			maxPaymentAttempts: options.maxPaymentAttempts,
		},
	};
}

export async function fetchOttoRouterBalance(
	auth: OttoRouterAuth,
	baseURL?: string,
): Promise<OttoRouterBalanceResponse | null> {
	return fetchBalance(auth, baseURL);
}

export function getPublicKeyFromPrivate(privateKey: string): string | null {
	return _getPublicKeyFromPrivate(privateKey);
}

export async function fetchSolanaUsdcBalance(
	auth: OttoRouterAuth,
	network: 'mainnet' | 'devnet' = 'mainnet',
): Promise<SolanaUsdcBalanceResponse | null> {
	if (auth.privateKey) {
		return fetchWalletUsdcBalance({ privateKey: auth.privateKey }, network);
	}
	if (auth.signer?.walletAddress) {
		return fetchWalletUsdcBalance(
			{ walletAddress: auth.signer.walletAddress },
			network,
		);
	}
	return null;
}

export { createOttoRouter, type OttoRouterInstance };
