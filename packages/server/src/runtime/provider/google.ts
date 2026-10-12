import type { OttoConfig } from '@ottocode/sdk';
import { getProviderDefinition } from '@ottocode/sdk';
import { createProviderModel } from '@ottocode/sdk/providers';
import { getRunProviderApiKey } from './credentials.ts';
import { providerFetch } from './fetch.ts';

export async function resolveGoogleModel(model: string, cfg: OttoConfig) {
	return createProviderModel('google', model, {
		apiKey: await getRunProviderApiKey(cfg, 'google'),
		baseURL: getProviderDefinition(cfg, 'google')?.baseURL,
		customFetch: providerFetch,
	});
}
