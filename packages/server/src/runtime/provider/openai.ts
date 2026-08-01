import type { OttoConfig } from '@ottocode/sdk';
import {
	getAuth,
	createOpenAIOAuthModel,
	createPromptCacheKeyFetch,
} from '@ottocode/sdk';
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
		const instance = createOpenAI({
			apiKey: auth.key,
			fetch: createPromptCacheKeyFetch(providerFetch, sessionId),
		});
		return instance(model);
	}
	return createOpenAI({
		fetch: createPromptCacheKeyFetch(providerFetch, sessionId),
	})(model);
}
