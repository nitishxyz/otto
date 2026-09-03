import type { OttoConfig } from '@ottocode/sdk';
import {
	getAuth,
	setAuth,
	refreshXaiToken,
	createXaiModel,
	isXaiGrokCliModel,
} from '@ottocode/sdk';
import { providerFetch } from './fetch.ts';

export async function getXaiInstance(
	cfg: OttoConfig,
	model: string,
	sessionId?: string,
) {
	const auth = await getAuth('xai', cfg.projectRoot);
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
		return createXaiModel(model, {
			apiKey: currentAuth.access,
			useResponses: true,
			useGrokCliProxy: isXaiGrokCliModel(model),
			promptCacheKey: sessionId,
			fetch: providerFetch,
		});
	}

	if (isXaiGrokCliModel(model)) {
		throw new Error(
			'Grok Build and Grok Composer 2.5 require xAI OAuth. Run `otto auth login xai --method oauth` or reuse the official Grok CLI login.',
		);
	}

	const apiKey = auth?.type === 'api' ? auth.key : undefined;
	return createXaiModel(model, {
		apiKey,
		promptCacheKey: sessionId,
		fetch: providerFetch,
	});
}
