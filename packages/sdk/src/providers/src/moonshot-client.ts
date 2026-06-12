import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { OAuth } from '../../types/src/index.ts';
import { catalog } from './catalog-merged.ts';

export type KimiProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	oauth?: OAuth;
};

/** @deprecated Use `KimiProviderConfig` */
export type MoonshotProviderConfig = KimiProviderConfig;

export function readKimiApiKeyFromEnv(): string {
	return process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || '';
}

export function createKimiModel(model: string, config?: KimiProviderConfig) {
	const entry = catalog.moonshot;
	const oauthAccess = config?.oauth?.access;
	const defaultApiBaseURL = entry?.api ?? 'https://api.moonshot.ai/v1';
	const configuredBaseURL = config?.baseURL;
	const kimiCodeBaseURL =
		process.env.KIMI_CODE_BASE_URL ?? 'https://api.kimi.com/coding/v1';
	const baseURL =
		oauthAccess &&
		(!configuredBaseURL || configuredBaseURL === defaultApiBaseURL)
			? kimiCodeBaseURL
			: (configuredBaseURL ?? defaultApiBaseURL);
	const apiKey = oauthAccess || config?.apiKey || readKimiApiKeyFromEnv();
	const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;

	const instance = createOpenAICompatible({
		name: 'Kimi',
		baseURL,
		headers,
	});

	return instance(model);
}

/** @deprecated Use `createKimiModel` */
export function createMoonshotModel(
	model: string,
	config?: MoonshotProviderConfig,
) {
	return createKimiModel(model, config);
}
