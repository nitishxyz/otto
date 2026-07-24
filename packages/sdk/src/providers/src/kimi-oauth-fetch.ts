import type { OAuth } from '../../types/src/index.ts';
import { getFreshKimiOAuth } from '../../auth/src/kimi-refresh.ts';

function normalizeExpiresMs(expires: number): number {
	if (!Number.isFinite(expires) || expires <= 0) return 0;
	return expires < 1_000_000_000_000 ? expires * 1000 : expires;
}

function isKimiOAuthFresh(oauth: OAuth): boolean {
	const expires = normalizeExpiresMs(oauth.expires);
	return !expires || expires >= Date.now() + 5 * 60_000;
}

/**
 * Applies the latest Kimi OAuth token to every request. A backend 401 forces
 * one coordinated token rotation and retries the request once.
 */
export function createKimiOAuthFetch(
	oauth: OAuth,
	projectRoot?: string,
	baseFetch: typeof fetch = fetch,
): typeof fetch {
	let currentOAuth = oauth;

	const execute = (
		input: Parameters<typeof fetch>[0],
		init: Parameters<typeof fetch>[1],
		access: string,
	) => {
		const headers = new Headers(input instanceof Request ? input.headers : {});
		if (init?.headers) {
			new Headers(init.headers).forEach((value, key) => {
				headers.set(key, value);
			});
		}
		headers.set('Authorization', `Bearer ${access}`);
		return baseFetch(input, { ...init, headers });
	};

	const wrappedFetch = async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	): Promise<Response> => {
		if (!isKimiOAuthFresh(currentOAuth)) {
			currentOAuth = (await getFreshKimiOAuth({ projectRoot })) ?? currentOAuth;
		}

		let response = await execute(input, init, currentOAuth.access);
		if (response.status !== 401) return response;

		const rejectedAccess = currentOAuth.access;
		const refreshed = await getFreshKimiOAuth({
			projectRoot,
			staleAccess: rejectedAccess,
		});
		if (!refreshed || refreshed.access === rejectedAccess) return response;

		await response.body?.cancel().catch(() => {});
		currentOAuth = refreshed;
		response = await execute(input, init, currentOAuth.access);
		return response;
	};

	return wrappedFetch as typeof fetch;
}
