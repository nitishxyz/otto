import { getOpenRouterInstance } from '@ottocode/sdk';
import { createProviderModel } from '@ottocode/sdk/providers';
import { providerFetch } from './fetch.ts';

export { getOpenRouterInstance };

export function resolveOpenRouterModel(
	model: string,
	sessionId?: string,
	apiKey?: string,
	baseURL?: string,
) {
	return createProviderModel('openrouter', model, {
		apiKey,
		baseURL,
		customFetch: providerFetch,
		sessionId,
	});
}
