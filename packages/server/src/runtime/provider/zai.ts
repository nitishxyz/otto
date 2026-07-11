import type { OttoConfig } from '@ottocode/sdk';
import { getAuth, createZaiModel, createZaiCodingModel } from '@ottocode/sdk';
import { providerFetch } from './fetch.ts';

export async function getZaiInstance(cfg: OttoConfig, model: string) {
	const auth = await getAuth('zai', cfg.projectRoot);
	const apiKey = auth?.type === 'api' ? auth.key : undefined;
	return createZaiModel(model, { apiKey, fetch: providerFetch });
}

export async function getZaiCodingInstance(cfg: OttoConfig, model: string) {
	const auth = await getAuth('zai-coding', cfg.projectRoot);
	const apiKey = auth?.type === 'api' ? auth.key : undefined;
	return createZaiCodingModel(model, { apiKey, fetch: providerFetch });
}
