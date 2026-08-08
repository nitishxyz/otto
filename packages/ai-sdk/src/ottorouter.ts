import type {
	OttoRouterConfig,
	ProviderId,
	ProviderApiFormat,
	FetchFunction,
	BalanceResponse,
	WalletUsdcBalance,
	OttoRouterAuth,
} from './types.ts';
import { createOttoRouterFetch } from './fetch.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { createModel } from './providers/factory.ts';
import { fetchBalance } from './balance.ts';

const DEFAULT_BASE_URL = 'https://api.ottorouter.org';

function trimTrailingSlash(url: string) {
	return url.endsWith('/') ? url.slice(0, -1) : url;
}

export interface OttoRouterProvider {
	model(modelId: string): ReturnType<typeof createModel>;
}

export interface OttoRouterInstance {
	model(modelId: string): ReturnType<typeof createModel>;
	provider(
		providerId: ProviderId,
		apiFormat?: ProviderApiFormat,
	): OttoRouterProvider;
	fetch(): FetchFunction;
	balance(): Promise<BalanceResponse | null>;
	walletBalance(
		network?: 'mainnet' | 'devnet',
	): Promise<WalletUsdcBalance | null>;
	walletAddress: string | null;
	registry: ProviderRegistry;
}

function resolveAuth(auth: OttoRouterAuth): OttoRouterAuth {
	if (auth.apiKey || auth.accessToken || auth.refreshToken) {
		return auth;
	}

	throw new Error('OttoRouter: API key or OAuth token is required.');
}

export function createOttoRouter(config: OttoRouterConfig): OttoRouterInstance {
	const baseURL = trimTrailingSlash(config.baseURL ?? DEFAULT_BASE_URL);
	const resolvedAuth = resolveAuth(config.auth);
	const registry = new ProviderRegistry(config.providers, config.modelMap);

	const ottorouterFetch = createOttoRouterFetch({
		auth: resolvedAuth,
		baseURL,
		fetch: config.fetch,
		callbacks: config.callbacks,
		cache: config.cache,
		payment: config.payment,
	});

	const modelBaseURL = `${baseURL}/v1`;

	return {
		model(modelId: string) {
			const resolved = registry.resolve(modelId);
			if (!resolved) {
				throw new Error(
					`OttoRouter: unknown model "${modelId}". Register it via providers or modelMap config.`,
				);
			}
			return createModel(
				modelId,
				resolved.apiFormat,
				resolved.providerId,
				modelBaseURL,
				ottorouterFetch,
				config.middleware,
			);
		},

		provider(
			providerId: ProviderId,
			apiFormat?: ProviderApiFormat,
		): OttoRouterProvider {
			return {
				model(modelId: string) {
					const resolved = registry.resolve(modelId);
					const format = apiFormat ?? resolved?.apiFormat ?? 'openai-chat';
					return createModel(
						modelId,
						format,
						providerId,
						modelBaseURL,
						ottorouterFetch,
						config.middleware,
					);
				},
			};
		},

		fetch(): FetchFunction {
			return ottorouterFetch;
		},

		async balance() {
			return fetchBalance(resolvedAuth, baseURL);
		},

		async walletBalance(network?: 'mainnet' | 'devnet') {
			void network;
			return null;
		},

		walletAddress: null,

		registry,
	};
}
