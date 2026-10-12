import type { OttoConfig } from '@ottocode/sdk';
import { createProviderModel } from '@ottocode/sdk/providers';
import { providerFetch } from './fetch.ts';
import { getRunProviderAuth } from './credentials.ts';

export async function resolveOpenAIModel(
	model: string,
	cfg: OttoConfig,
	sessionId?: string,
) {
	const auth = await getRunProviderAuth('openai', cfg.projectRoot);
	return createProviderModel('openai', model, {
		apiKey: auth?.type === 'api' ? auth.key : undefined,
		oauth: auth?.type === 'oauth' ? auth : undefined,
		projectRoot: cfg.projectRoot,
		sessionId,
		baseURL: cfg.providers?.openai?.baseURL,
		customFetch: providerFetch,
	});
}
