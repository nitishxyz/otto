import type { OttoConfig } from '@ottocode/sdk';
import { getProviderDefinition } from '@ottocode/sdk';
import { createProviderModel } from '@ottocode/sdk/providers';
import { getRunProviderApiKey } from './credentials.ts';
import { providerFetch } from './fetch.ts';

export async function getZaiInstance(cfg: OttoConfig, model: string) {
	return createProviderModel('zai', model, {
		apiKey: await getRunProviderApiKey(cfg, 'zai'),
		baseURL: getProviderDefinition(cfg, 'zai')?.baseURL,
		customFetch: providerFetch,
	});
}

export async function getZaiCodingInstance(cfg: OttoConfig, model: string) {
	return createProviderModel('zai-coding', model, {
		apiKey: await getRunProviderApiKey(cfg, 'zai-coding'),
		baseURL: getProviderDefinition(cfg, 'zai-coding')?.baseURL,
		customFetch: providerFetch,
	});
}
