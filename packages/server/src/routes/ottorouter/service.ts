import {
	fetchOttoRouterBalance,
	getAuth,
	refreshOttoRouterToken,
	setAuth,
} from '@ottocode/sdk';

const OTTOROUTER_BASE_URL =
	process.env.OTTOROUTER_BASE_URL || 'https://api.ottorouter.org';
const TOKEN_REFRESH_WINDOW_MS = 5 * 60_000;
const refreshes = new Map<string, ReturnType<typeof refreshOttoRouterToken>>();

function refreshTokenOnce(refreshToken: string) {
	let pending = refreshes.get(refreshToken);
	if (!pending) {
		pending = refreshOttoRouterToken(refreshToken).finally(() => {
			refreshes.delete(refreshToken);
		});
		refreshes.set(refreshToken, pending);
	}
	return pending;
}

export function getOttoRouterBaseUrl(): string {
	return OTTOROUTER_BASE_URL.endsWith('/')
		? OTTOROUTER_BASE_URL.slice(0, -1)
		: OTTOROUTER_BASE_URL;
}

export async function getOttoRouterOAuthAuth(projectRoot?: string) {
	const auth = await getAuth('ottorouter', projectRoot);
	if (auth?.type !== 'oauth' || !auth.access) {
		return null;
	}

	let access = auth.access;
	let refresh = auth.refresh;
	let expires = auth.expires;
	if (refresh && expires && expires < Date.now() + TOKEN_REFRESH_WINDOW_MS) {
		const tokens = await refreshTokenOnce(refresh);
		access = tokens.access;
		refresh = tokens.refresh;
		expires = tokens.expires;
		await setAuth(
			'ottorouter',
			{
				type: 'oauth',
				access,
				refresh,
				expires,
				idToken: tokens.idToken ?? auth.idToken,
				scopes: tokens.scopes ?? auth.scopes,
			},
			projectRoot,
			'global',
		);
	}

	return {
		accessToken: access,
		refreshToken: refresh,
		expiresAt: expires,
		onTokenRefresh: async (tokens: {
			accessToken: string;
			refreshToken?: string;
			expiresAt?: number;
		}) => {
			await setAuth(
				'ottorouter',
				{
					type: 'oauth',
					access: tokens.accessToken,
					refresh: tokens.refreshToken ?? refresh,
					expires: tokens.expiresAt ?? Date.now() + 60 * 60 * 1000,
					idToken: auth.idToken,
					scopes: auth.scopes,
				},
				projectRoot,
				'global',
			);
		},
	};
}

export async function getOttoRouterAuthHeaders(
	projectRoot?: string,
): Promise<Record<string, string> | null> {
	const auth = await getOttoRouterOAuthAuth(projectRoot);
	if (!auth) return null;
	return { Authorization: `Bearer ${auth.accessToken}` };
}

export async function getOttoRouterBalance(projectRoot?: string) {
	const auth = await getOttoRouterOAuthAuth(projectRoot);
	if (!auth) {
		return {
			ok: false as const,
			body: { error: 'OttoRouter OAuth not configured' },
			status: 401 as const,
		};
	}

	const balance = await fetchOttoRouterBalance(auth);
	if (!balance) {
		return {
			ok: false as const,
			body: { error: 'Failed to fetch balance from OttoRouter' },
			status: 502 as const,
		};
	}

	return { ok: true as const, body: balance };
}

export async function getOttoRouterAuthInfo(projectRoot?: string) {
	const auth = await getOttoRouterOAuthAuth(projectRoot);
	if (!auth) {
		return {
			configured: false,
			error: 'OttoRouter OAuth not configured',
		};
	}

	return {
		configured: true,
		expiresAt: auth.expiresAt,
	};
}
