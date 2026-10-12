import {
	createProviderModel,
	type ProviderModelConfig,
} from '../../../providers/src/dispatch.ts';
import { getFreshOttoRouterOAuth } from '../../../auth/src/ottorouter-refresh.ts';
import type { BuiltInProviderId } from '../../../types/src/index.ts';

export type ProviderName = BuiltInProviderId;
export type ModelConfig = ProviderModelConfig;

export async function resolveModel(
	provider: ProviderName,
	model: string,
	config: ModelConfig = {},
) {
	if (provider !== 'ottorouter' || config.ottorouterAuth) {
		return createProviderModel(provider, model, config);
	}
	if (!config.oauth?.access) {
		throw new Error(
			'OttoRouter provider requires OAuth. Run `otto auth login ottorouter`.',
		);
	}
	return createProviderModel(provider, model, {
		...config,
		baseURL: config.baseURL || process.env.OTTOROUTER_BASE_URL,
		ottorouterAuth: {
			accessToken: config.oauth.access,
			refreshToken: config.oauth.refresh,
			expiresAt: config.oauth.expires,
			refreshAccessToken: async (options?: { staleAccessToken?: string }) => {
				const next = await getFreshOttoRouterOAuth({
					projectRoot: config.projectRoot,
					staleAccess: options?.staleAccessToken,
				});
				if (!next) throw new Error('OttoRouter OAuth is no longer configured.');
				return {
					accessToken: next.access,
					refreshToken: next.refresh,
					expiresAt: next.expires,
				};
			},
		},
	});
}
