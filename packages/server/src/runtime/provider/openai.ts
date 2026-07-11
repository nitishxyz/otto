import type { OttoConfig } from '@ottocode/sdk';
import { getAuth, createOpenAIOAuthModel } from '@ottocode/sdk';
import { createOpenAI } from '@ai-sdk/openai';
import { providerFetch } from './fetch.ts';

export async function resolveOpenAIModel(
	model: string,
	cfg: OttoConfig,
	sessionId?: string,
) {
	const auth = await getAuth('openai', cfg.projectRoot);
	if (auth?.type === 'oauth') {
		return createOpenAIOAuthModel(model, {
			oauth: auth,
			projectRoot: cfg.projectRoot,
			sessionId,
		});
	}
	if (auth?.type === 'api' && auth.key) {
		const instance = createOpenAI({ apiKey: auth.key, fetch: providerFetch });
		return instance(model);
	}
	return createOpenAI({ fetch: providerFetch })(model);
}
