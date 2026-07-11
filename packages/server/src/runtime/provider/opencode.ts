import type { OttoConfig } from '@ottocode/sdk';
import { createOpencodeModel } from '@ottocode/sdk';
import { providerFetch } from './fetch.ts';

export function resolveOpencodeModel(model: string, _cfg: OttoConfig) {
	const apiKey = process.env.OPENCODE_API_KEY;
	return createOpencodeModel(model, { apiKey, fetch: providerFetch });
}
