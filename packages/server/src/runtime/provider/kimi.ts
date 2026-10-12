import type { OttoConfig } from '@ottocode/sdk';
import { getProviderDefinition } from '@ottocode/sdk';
import { createProviderModel } from '@ottocode/sdk/providers';
import { getRunProviderAuth } from './credentials.ts';
import { providerFetch } from './fetch.ts';

export async function getKimiInstance(
	cfg: OttoConfig,
	model: string,
	sessionId?: string,
) {
	const auth = await getRunProviderAuth('kimi', cfg.projectRoot);
	const apiKey = auth?.type === 'api' ? auth.key : undefined;
	const oauth = auth?.type === 'oauth' ? auth : undefined;
	return createProviderModel('kimi', model, {
		apiKey,
		oauth,
		projectRoot: cfg.projectRoot,
		baseURL: getProviderDefinition(cfg, 'kimi')?.baseURL,
		customFetch: providerFetch,
		sessionId,
	});
}
