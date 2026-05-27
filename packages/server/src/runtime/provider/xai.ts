import type { OttoConfig } from '@ottocode/sdk';
import {
	getAuth,
	setAuth,
	refreshXaiToken,
	createXaiModel,
} from '@ottocode/sdk';

export async function getXaiInstance(cfg: OttoConfig, model: string) {
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
		});
	}

	const apiKey = auth?.type === 'api' ? auth.key : undefined;
	return createXaiModel(model, { apiKey });
}
