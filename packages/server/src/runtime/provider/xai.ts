import type { OttoConfig } from '@ottocode/sdk';
import {
	setAuth,
	refreshXaiToken,
	isXaiGrokCliModel,
	getProviderDefinition,
} from '@ottocode/sdk';
import { createProviderModel } from '@ottocode/sdk/providers';
import { getRunProviderAuth } from './credentials.ts';
import { providerFetch } from './fetch.ts';

export async function getXaiInstance(
	cfg: OttoConfig,
	model: string,
	sessionId?: string,
) {
	const auth = await getRunProviderAuth('xai', cfg.projectRoot);
	if (auth?.type === 'oauth') {
		let currentAuth = auth;
		if (currentAuth.expires < Date.now()) {
			const tokens = await refreshXaiToken(currentAuth.refresh);
			currentAuth = {
				type: 'oauth',
				refresh: tokens.refresh,
				access: tokens.access,
				expires: tokens.expires,
				idToken: tokens.idToken,
				scopes: tokens.scopes,
			};
			await setAuth('xai', currentAuth, cfg.projectRoot, 'global');
		}
		return createProviderModel('xai', model, {
			oauth: currentAuth,
			sessionId,
			baseURL: getProviderDefinition(cfg, 'xai')?.baseURL,
			customFetch: providerFetch,
		});
	}

	if (isXaiGrokCliModel(model)) {
		throw new Error(
			'Grok Build and Grok Composer 2.5 require xAI OAuth. Run `otto auth login xai --method oauth` or reuse the official Grok CLI login.',
		);
	}

	const apiKey = auth?.type === 'api' ? auth.key : undefined;
	return createProviderModel('xai', model, {
		apiKey,
		sessionId,
		baseURL: getProviderDefinition(cfg, 'xai')?.baseURL,
		customFetch: providerFetch,
	});
}
