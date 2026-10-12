import type { OttoConfig } from '@ottocode/sdk';
import { createProviderModel } from '@ottocode/sdk/providers';
import { toClaudeCodeName } from '../tools/mapping.ts';
import { providerFetch } from './fetch.ts';
import { getRunProviderAuth } from './credentials.ts';

export async function getAnthropicInstance(cfg: OttoConfig) {
	const auth = await getRunProviderAuth('anthropic', cfg.projectRoot);
	return (model: string) =>
		createProviderModel('anthropic', model, {
			apiKey: auth?.type === 'api' ? auth.key : undefined,
			oauth: auth?.type === 'oauth' ? auth : undefined,
			authMode: 'managed',
			projectRoot: cfg.projectRoot,
			toolNameTransformer: toClaudeCodeName,
			baseURL: cfg.providers?.anthropic?.baseURL,
			customFetch: providerFetch,
		});
}
