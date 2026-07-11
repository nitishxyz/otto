import type { OttoConfig } from '@ottocode/sdk';
import {
	getAuth,
	createAnthropicOAuthModel,
	createAnthropicCachingFetch,
} from '@ottocode/sdk';
import { createAnthropic } from '@ai-sdk/anthropic';
import { toClaudeCodeName } from '../tools/mapping.ts';
import { providerFetch } from './fetch.ts';

export async function getAnthropicInstance(cfg: OttoConfig) {
	const auth = await getAuth('anthropic', cfg.projectRoot);

	if (auth?.type === 'oauth') {
		return (model: string) =>
			createAnthropicOAuthModel(model, {
				oauth: {
					access: auth.access,
					refresh: auth.refresh,
					expires: auth.expires,
				},
				projectRoot: cfg.projectRoot,
				toolNameTransformer: toClaudeCodeName,
			});
	}

	const cachingFetch = createAnthropicCachingFetch(providerFetch);
	return createAnthropic({
		fetch: cachingFetch as typeof fetch,
	});
}
