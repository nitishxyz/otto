import type { OttoConfig } from '@ottocode/sdk';
import { getProviderDefinition } from '@ottocode/sdk';
import { createProviderModel } from '@ottocode/sdk/providers';
import { getRunProviderApiKey } from './credentials.ts';
import { providerFetch } from './fetch.ts';

export async function getMinimaxInstance(cfg: OttoConfig, model: string) {
	return createProviderModel('minimax', model, {
		apiKey: await getRunProviderApiKey(cfg, 'minimax'),
		baseURL: getProviderDefinition(cfg, 'minimax')?.baseURL,
		customFetch: providerFetch,
	});
}
