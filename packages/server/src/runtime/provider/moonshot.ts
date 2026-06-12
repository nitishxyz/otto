import type { OttoConfig, OAuth } from '@ottocode/sdk';
import {
	getAuth,
	setAuth,
	refreshKimiToken,
	createMoonshotModel,
} from '@ottocode/sdk';

const KIMI_REFRESH_SKEW_MS = 5 * 60 * 1000;

function normalizeExpiresMs(expires: number): number {
	if (!Number.isFinite(expires) || expires <= 0) return 0;
	return expires < 1_000_000_000_000 ? expires * 1000 : expires;
}

async function ensureFreshKimiOAuth(
	oauth: OAuth,
	providerKey: 'moonshot' | 'kimi',
	projectRoot: string,
): Promise<OAuth> {
	if (!oauth.refresh) return oauth;
	const expiresMs = normalizeExpiresMs(oauth.expires);
	if (expiresMs && expiresMs - Date.now() > KIMI_REFRESH_SKEW_MS) return oauth;
	const tokens = await refreshKimiToken(oauth.refresh);
	const next: OAuth = {
		type: 'oauth',
		access: tokens.access,
		refresh: tokens.refresh,
		expires: tokens.expires,
		scopes: tokens.scopes ?? oauth.scopes,
	};
	await setAuth(providerKey, next, projectRoot, 'global');
	return next;
}

export async function getMoonshotInstance(cfg: OttoConfig, model: string) {
	const moonshotAuth = await getAuth('moonshot', cfg.projectRoot);
	const auth = moonshotAuth ?? (await getAuth('kimi', cfg.projectRoot));
	const providerKey: 'moonshot' | 'kimi' = moonshotAuth ? 'moonshot' : 'kimi';
	const apiKey = auth?.type === 'api' ? auth.key : undefined;
	let oauth = auth?.type === 'oauth' ? auth : undefined;
	if (oauth) {
		oauth = await ensureFreshKimiOAuth(oauth, providerKey, cfg.projectRoot);
	}
	return createMoonshotModel(model, { apiKey, oauth });
}
