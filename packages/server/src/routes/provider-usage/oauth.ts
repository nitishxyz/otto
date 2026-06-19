import {
	getAuth,
	refreshKimiToken,
	refreshOpenAIToken,
	refreshToken,
	setAuth,
	type OAuth,
	type ProviderId,
} from '@ottocode/sdk';

export async function ensureValidOAuth(
	provider: ProviderId,
): Promise<{ access: string; oauth: OAuth } | null> {
	const projectRoot = process.cwd();
	const auth = await getAuth(provider, projectRoot);
	if (!auth || auth.type !== 'oauth') return null;

	if (auth.access && auth.expires > Date.now()) {
		return { access: auth.access, oauth: auth };
	}

	try {
		const refreshFn =
			provider === 'openai'
				? refreshOpenAIToken
				: provider === 'kimi'
					? refreshKimiToken
					: refreshToken;
		const newTokens = await refreshFn(auth.refresh);
		const updated: OAuth = {
			...auth,
			access: newTokens.access,
			refresh: newTokens.refresh,
			expires: newTokens.expires,
		};
		await setAuth(provider, updated, projectRoot, 'global');
		return { access: updated.access, oauth: updated };
	} catch {
		return { access: auth.access, oauth: auth };
	}
}
