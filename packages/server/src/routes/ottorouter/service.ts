import { fetchOttoRouterBalance, getFreshOttoRouterOAuth } from '@ottocode/sdk';

const OTTOROUTER_BASE_URL =
	process.env.OTTOROUTER_BASE_URL || 'https://api.ottorouter.org';

export function getOttoRouterBaseUrl(): string {
	return OTTOROUTER_BASE_URL.endsWith('/')
		? OTTOROUTER_BASE_URL.slice(0, -1)
		: OTTOROUTER_BASE_URL;
}

export async function getOttoRouterOAuthAuth(projectRoot?: string) {
	const auth = await getFreshOttoRouterOAuth({ projectRoot });
	if (!auth) return null;

	return {
		accessToken: auth.access,
		refreshToken: auth.refresh,
		expiresAt: auth.expires,
		refreshAccessToken: async (options?: { staleAccessToken?: string }) => {
			const next = await getFreshOttoRouterOAuth({
				projectRoot,
				staleAccess: options?.staleAccessToken,
			});
			if (!next) {
				throw new Error('OttoRouter OAuth is no longer configured.');
			}
			return {
				accessToken: next.access,
				refreshToken: next.refresh,
				expiresAt: next.expires,
			};
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

/**
 * Performs an authenticated OttoRouter API request. When the backend rejects
 * the bearer token with 401, forces one coordinated token refresh and retries
 * the request once. Returns null when OttoRouter OAuth is not configured.
 */
export async function fetchWithOttoRouterAuth(
	input: string,
	init: RequestInit = {},
	fetcher: typeof globalThis.fetch = globalThis.fetch,
	projectRoot?: string,
): Promise<Response | null> {
	const auth = await getOttoRouterOAuthAuth(projectRoot);
	if (!auth) return null;
	const request = (token: string) => {
		const headers = new Headers(init.headers);
		headers.set('Authorization', `Bearer ${token}`);
		return fetcher(input, { ...init, headers });
	};
	const response = await request(auth.accessToken);
	if (response.status !== 401) return response;
	try {
		const next = await auth.refreshAccessToken({
			staleAccessToken: auth.accessToken,
		});
		return await request(next.accessToken);
	} catch {
		return response;
	}
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
