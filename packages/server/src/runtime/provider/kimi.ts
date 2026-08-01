import type { OttoConfig } from '@ottocode/sdk';
import { getAuth, createKimiModel } from '@ottocode/sdk';
import { providerFetch } from './fetch.ts';

export async function getKimiInstance(
	cfg: OttoConfig,
	model: string,
	sessionId?: string,
) {
	const auth = await getAuth('kimi', cfg.projectRoot);
	const apiKey = auth?.type === 'api' ? auth.key : undefined;
	const oauth = auth?.type === 'oauth' ? auth : undefined;
	return createKimiModel(model, {
		apiKey,
		oauth,
		projectRoot: cfg.projectRoot,
		fetch: providerFetch,
		promptCacheKey: sessionId,
	});
}
