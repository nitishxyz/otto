import type { WalletContext } from './auth.ts';
import type { FetchFunction, OttoRouterAuth } from './types.ts';

const DEFAULT_TOKEN_REFRESH_SKEW_MS = 60_000;
const DEFAULT_TOKEN_TTL_MS = 5 * 60_000;
const DEFAULT_OAUTH_CLIENT_ID = 'ottocode-cli';

interface AccessTokenState {
	token: string;
	expiresAt: number;
}

export interface AccessTokenManager {
	getToken(forceRefresh?: boolean): Promise<string>;
	invalidate(): void;
}

interface CreateAccessTokenManagerOptions {
	wallet: WalletContext;
	baseURL: string;
	fetch?: FetchFunction;
	tokenRefreshSkewMs?: number;
}

interface CreateOAuthAccessTokenManagerOptions {
	auth: OttoRouterAuth;
	baseURL: string;
	fetch?: FetchFunction;
	tokenRefreshSkewMs?: number;
}

interface WalletTokenResponse {
	accessToken?: string;
	access_token?: string;
	token?: string;
	expiresAt?: number | string;
	expires_at?: number | string;
	expiresIn?: number | string;
	expires_in?: number | string;
}

interface OAuthTokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number | string;
	expires_at?: number | string;
}

interface OAuthTokenState extends AccessTokenState {
	refreshToken: string;
}

const oauthRefreshes = new Map<string, Promise<OAuthTokenState>>();
const externalOAuthRefreshes = new WeakMap<
	OttoRouterAuth,
	Promise<AccessTokenState>
>();

function trimTrailingSlash(url: string) {
	return url.endsWith('/') ? url.slice(0, -1) : url;
}

function oauthResource(baseURL: string) {
	return `${trimTrailingSlash(baseURL)}/api/auth`;
}

function parseNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function parseJwtExpiry(token: string): number | null {
	const parts = token.split('.');
	if (parts.length < 2) return null;
	try {
		const base64 = parts[1]?.replace(/-/g, '+').replace(/_/g, '/');
		if (!base64) return null;
		const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
		const json = JSON.parse(atob(padded)) as {
			exp?: unknown;
		};
		const exp = parseNumber(json.exp);
		return exp != null ? exp * 1000 : null;
	} catch {
		return null;
	}
}

function resolveExpiresAt(payload: WalletTokenResponse, token: string): number {
	const expiresAt = parseNumber(payload.expiresAt ?? payload.expires_at);
	if (expiresAt != null) {
		return expiresAt > 1_000_000_000_000 ? expiresAt : expiresAt * 1000;
	}

	const expiresIn = parseNumber(payload.expiresIn ?? payload.expires_in);
	if (expiresIn != null) {
		return Date.now() + expiresIn * 1000;
	}

	return parseJwtExpiry(token) ?? Date.now() + DEFAULT_TOKEN_TTL_MS;
}

async function exchangeWalletToken(
	wallet: WalletContext,
	baseURL: string,
	baseFetch: FetchFunction,
): Promise<AccessTokenState> {
	const walletHeaders = await (
		wallet.buildWalletAuthHeaders ?? wallet.buildHeaders
	)();
	const response = await baseFetch(
		`${trimTrailingSlash(baseURL)}/v1/auth/wallet-token`,
		{
			method: 'POST',
			headers: walletHeaders,
		},
	);

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(
			`OttoRouter: wallet token exchange failed (${response.status})${body ? `: ${body}` : ''}`,
		);
	}

	const payload = (await response.json()) as WalletTokenResponse;
	const token = payload.accessToken ?? payload.access_token ?? payload.token;
	if (!token) {
		throw new Error(
			'OttoRouter: wallet token exchange response missing access token.',
		);
	}

	return {
		token,
		expiresAt: resolveExpiresAt(payload, token),
	};
}

export function createAccessTokenManager(
	options: CreateAccessTokenManagerOptions,
): AccessTokenManager {
	const {
		wallet,
		baseURL,
		fetch: customFetch,
		tokenRefreshSkewMs = DEFAULT_TOKEN_REFRESH_SKEW_MS,
	} = options;
	const baseFetch = customFetch ?? globalThis.fetch.bind(globalThis);
	let state: AccessTokenState | null = null;
	let inFlight: Promise<string> | null = null;

	const hasValidToken = () =>
		state != null && Date.now() + tokenRefreshSkewMs < state.expiresAt;

	const refresh = async () => {
		const next = await exchangeWalletToken(wallet, baseURL, baseFetch);
		state = next;
		return next.token;
	};

	return {
		async getToken(forceRefresh = false) {
			if (!forceRefresh && hasValidToken() && state) {
				return state.token;
			}

			if (!inFlight) {
				inFlight = refresh().finally(() => {
					inFlight = null;
				});
			}

			return inFlight;
		},
		invalidate() {
			state = null;
		},
	};
}

async function refreshOAuthToken(
	auth: OttoRouterAuth,
	baseURL: string,
	baseFetch: FetchFunction,
): Promise<AccessTokenState> {
	if (auth.refreshAccessToken) {
		let pending = externalOAuthRefreshes.get(auth);
		if (!pending) {
			pending = runExternalOAuthRefresh(auth).finally(() => {
				externalOAuthRefreshes.delete(auth);
			});
			externalOAuthRefreshes.set(auth, pending);
		}
		return pending;
	}
	if (!auth.refreshToken) {
		throw new Error('OttoRouter: OAuth refresh token is not configured.');
	}
	const currentRefreshToken = auth.refreshToken;
	const refreshKey = `${trimTrailingSlash(baseURL)}::${auth.clientId ?? DEFAULT_OAUTH_CLIENT_ID}::${currentRefreshToken}`;
	let pending = oauthRefreshes.get(refreshKey);
	if (!pending) {
		pending = exchangeOAuthToken(
			auth.clientId ?? DEFAULT_OAUTH_CLIENT_ID,
			currentRefreshToken,
			baseURL,
			baseFetch,
		).finally(() => {
			oauthRefreshes.delete(refreshKey);
		});
		oauthRefreshes.set(refreshKey, pending);
	}
	const next = await pending;
	auth.accessToken = next.token;
	auth.refreshToken = next.refreshToken;
	auth.expiresAt = next.expiresAt;
	await auth.onTokenRefresh?.({
		accessToken: next.token,
		refreshToken: next.refreshToken,
		expiresAt: next.expiresAt,
	});

	return next;
}

async function runExternalOAuthRefresh(
	auth: OttoRouterAuth,
): Promise<AccessTokenState> {
	const refreshAccessToken = auth.refreshAccessToken;
	if (!refreshAccessToken) {
		throw new Error('OttoRouter: OAuth refresh is not configured.');
	}
	const next = await refreshAccessToken({
		staleAccessToken: auth.accessToken,
	});
	auth.accessToken = next.accessToken;
	if (next.refreshToken) auth.refreshToken = next.refreshToken;
	auth.expiresAt = next.expiresAt;
	return {
		token: next.accessToken,
		expiresAt:
			next.expiresAt ??
			parseJwtExpiry(next.accessToken) ??
			Date.now() + DEFAULT_TOKEN_TTL_MS,
	};
}

async function exchangeOAuthToken(
	clientId: string,
	refreshToken: string,
	baseURL: string,
	baseFetch: FetchFunction,
): Promise<OAuthTokenState> {
	const response = await baseFetch(
		`${trimTrailingSlash(baseURL)}/api/auth/oauth2/token`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				client_id: clientId,
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				resource: oauthResource(baseURL),
			}).toString(),
		},
	);

	const payload = (await response
		.json()
		.catch(() => ({}))) as OAuthTokenResponse & {
		error?: string;
		error_description?: string;
	};
	if (!response.ok || !payload.access_token) {
		const message =
			payload.error_description ?? payload.error ?? response.statusText;
		throw new Error(`OttoRouter: OAuth token refresh failed (${message})`);
	}

	const expiresAt = resolveExpiresAt(
		{
			expires_at: payload.expires_at,
			expires_in: payload.expires_in,
		},
		payload.access_token,
	);

	return {
		token: payload.access_token,
		expiresAt,
		refreshToken: payload.refresh_token ?? refreshToken,
	};
}

export function createOAuthAccessTokenManager(
	options: CreateOAuthAccessTokenManagerOptions,
): AccessTokenManager {
	const {
		auth,
		baseURL,
		fetch: customFetch,
		tokenRefreshSkewMs = DEFAULT_TOKEN_REFRESH_SKEW_MS,
	} = options;
	const baseFetch = customFetch ?? globalThis.fetch.bind(globalThis);
	let state: AccessTokenState | null = auth.accessToken
		? {
				token: auth.accessToken,
				expiresAt:
					auth.expiresAt ??
					parseJwtExpiry(auth.accessToken) ??
					Date.now() + DEFAULT_TOKEN_TTL_MS,
			}
		: null;
	let inFlight: Promise<string> | null = null;

	const hasValidToken = () =>
		state != null && Date.now() + tokenRefreshSkewMs < state.expiresAt;

	const refresh = async () => {
		const next = await refreshOAuthToken(auth, baseURL, baseFetch);
		state = next;
		return next.token;
	};

	return {
		async getToken(forceRefresh = false) {
			if (!forceRefresh && hasValidToken() && state) {
				return state.token;
			}

			if (
				!forceRefresh &&
				state &&
				!auth.refreshToken &&
				!auth.refreshAccessToken
			) {
				return state.token;
			}

			if (!inFlight) {
				inFlight = refresh().finally(() => {
					inFlight = null;
				});
			}

			return inFlight;
		},
		invalidate() {
			state = null;
		},
	};
}
