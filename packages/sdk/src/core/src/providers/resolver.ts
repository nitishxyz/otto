import {
	createBuiltInProviderModel,
	createKimiModel,
	createOpenAIOAuthModel,
	createOttoRouterModel,
	createXaiModel,
	isXaiGrokCliModel,
} from '../../../providers/src/index.ts';
import { createCopilotModel } from '../../../providers/src/copilot-client.ts';
import { getFreshOttoRouterOAuth } from '../../../auth/src/ottorouter-refresh.ts';
import type { BuiltInProviderId, OAuth } from '../../../types/src/index.ts';

export type ProviderName = BuiltInProviderId;

export type ModelConfig = {
	apiKey?: string;
	customFetch?: typeof fetch;
	baseURL?: string;
	oauth?: OAuth;
	projectRoot?: string;
};

export async function resolveModel(
	provider: ProviderName,
	model: string,
	config: ModelConfig = {},
) {
	if (provider === 'openai' && config.oauth) {
		return createOpenAIOAuthModel(model, {
			oauth: config.oauth,
			projectRoot: config.projectRoot,
		});
	}

	if (provider === 'copilot') {
		if (config.oauth) {
			return createCopilotModel(model, { oauth: config.oauth });
		}
		throw new Error(
			'Copilot provider requires OAuth. Run `otto auth login copilot`.',
		);
	}

	if (provider === 'ottorouter') {
		if (!config.oauth?.access) {
			throw new Error(
				'OttoRouter provider requires OAuth. Run `otto auth login ottorouter`.',
			);
		}
		const baseURL = config.baseURL || process.env.OTTOROUTER_BASE_URL;
		return createOttoRouterModel(
			model,
			{
				accessToken: config.oauth.access,
				refreshToken: config.oauth.refresh,
				expiresAt: config.oauth.expires,
				refreshAccessToken: async (options?: { staleAccessToken?: string }) => {
					const next = await getFreshOttoRouterOAuth({
						projectRoot: config.projectRoot,
						staleAccess: options?.staleAccessToken,
					});
					if (!next) {
						throw new Error('OttoRouter OAuth is no longer configured.');
					}
					return {
						accessToken: next.access,
						refreshToken: next.refresh,
						expiresAt: next.expires,
					};
				},
			},
			{ baseURL },
		);
	}

	if (provider === 'xai') {
		if (isXaiGrokCliModel(model) && !config.oauth) {
			throw new Error('Grok Build and Grok Composer 2.5 require xAI OAuth.');
		}
		return createXaiModel(model, {
			apiKey: config.oauth?.access ?? config.apiKey,
			baseURL: config.baseURL,
			useResponses: !!config.oauth,
			useGrokCliProxy: !!config.oauth && isXaiGrokCliModel(model),
		});
	}

	if (provider === 'kimi') {
		return createKimiModel(model, {
			apiKey: config.apiKey,
			baseURL: config.baseURL,
			oauth: config.oauth,
		});
	}

	return createBuiltInProviderModel(provider, model, config);
}
