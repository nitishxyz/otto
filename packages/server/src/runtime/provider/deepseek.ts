import type { OttoConfig } from '@ottocode/sdk';
import { getProviderDefinition } from '@ottocode/sdk';
import { createProviderModel } from '@ottocode/sdk/providers';
import { getRunProviderApiKey } from './credentials.ts';
import { providerFetch } from './fetch.ts';

export async function getDeepSeekInstance(cfg: OttoConfig, model: string) {
	return createProviderModel('deepseek', model, {
		apiKey: await getRunProviderApiKey(cfg, 'deepseek'),
		baseURL: getProviderDefinition(cfg, 'deepseek')?.baseURL,
		customFetch: providerFetch,
	});
}
