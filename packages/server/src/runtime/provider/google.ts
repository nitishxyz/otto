import type { OttoConfig } from '@ottocode/sdk';
import { getAuth, createGoogleModel } from '@ottocode/sdk';
import { providerFetch } from './fetch.ts';

export async function resolveGoogleModel(model: string, cfg: OttoConfig) {
	const auth = await getAuth('google', cfg.projectRoot);
	const apiKey = auth?.type === 'api' ? auth.key : undefined;
	return createGoogleModel(model, { apiKey, fetch: providerFetch });
}
