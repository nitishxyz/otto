import type { OttoConfig } from '@ottocode/sdk';
import { createProviderModel } from '@ottocode/sdk/providers';
import { providerFetch } from './fetch.ts';

export function resolveOpencodeModel(
	model: string,
	cfg: OttoConfig,
	sessionId?: string,
	requestApiKey?: string,
) {
	const apiKey = requestApiKey ?? process.env.OPENCODE_API_KEY;
	return createProviderModel('opencode', model, {
		apiKey,
		baseURL: cfg.providers?.opencode?.baseURL,
		sessionId,
		customFetch: providerFetch,
	});
}
