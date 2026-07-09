const DEFAULT_OTTOROUTER_BASE_URL = 'https://api.ottorouter.org';
const OTTOROUTER_OAUTH_CLIENT_ID = 'ottocode-cli';
const OTTOROUTER_OAUTH_SCOPE =
	'openid profile email offline_access inference account:read account:topup';

function ottorouterBaseUrl(): string {
	return (
		process.env.OTTOROUTER_BASE_URL ?? DEFAULT_OTTOROUTER_BASE_URL
	).replace(/\/$/, '');
}

function ottorouterOAuthResource(): string {
	return `${ottorouterBaseUrl()}/api/auth`;
}

/** OttoRouter OAuth tokens normalized to otto's OAuth auth shape. */
export type OttoRouterOAuthTokens = {
	access: string;
	refresh: string;
	expires: number;
	idToken?: string;
	scopes?: string;
};

/** Response from an OttoRouter OAuth device authorization request. */
export type OttoRouterDeviceCodeResponse = {
	userCode: string;
	deviceCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	interval: number;
	expiresIn: number | null;
};

/** Result of a single OttoRouter device-code token poll attempt. */
export type OttoRouterDevicePollResult =
	| { status: 'complete'; tokens: OttoRouterOAuthTokens }
	| { status: 'pending' }
	| { status: 'error'; error: string };

function normalizeTokens(
	data: Record<string, unknown>,
	previousRefresh?: string,
): OttoRouterOAuthTokens {
	const access = data.access_token;
	if (typeof access !== 'string' || !access) {
		throw new Error(
			'OttoRouter OAuth token response was missing access_token.',
		);
	}
	const refresh =
		typeof data.refresh_token === 'string' && data.refresh_token
			? data.refresh_token
			: (previousRefresh ?? '');
	const expiresIn = Number(data.expires_in ?? 3600);
	return {
		access,
		refresh,
		expires: Date.now() + expiresIn * 1000,
		idToken: typeof data.id_token === 'string' ? data.id_token : undefined,
		scopes: typeof data.scope === 'string' ? data.scope : undefined,
	};
}

function normalizeDeviceIntervalSeconds(raw: unknown): number {
	const interval = Number(raw ?? 5);
	if (!Number.isFinite(interval) || interval <= 0) return 5;
	return interval >= 1000 ? Math.ceil(interval / 1000) : interval;
}

/** Request an OttoRouter OAuth device authorization code. */
export async function requestOttoRouterDeviceCode(): Promise<OttoRouterDeviceCodeResponse> {
	const response = await fetch(`${ottorouterBaseUrl()}/api/auth/device/code`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			client_id: OTTOROUTER_OAUTH_CLIENT_ID,
			scope: OTTOROUTER_OAUTH_SCOPE,
		}),
	});
	const data = (await response.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	if (!response.ok) {
		const description =
			typeof data.error_description === 'string'
				? data.error_description
				: `HTTP ${response.status}`;
		throw new Error(
			`OttoRouter OAuth device authorization failed: ${description}`,
		);
	}
	if (
		typeof data.user_code !== 'string' ||
		typeof data.device_code !== 'string' ||
		typeof data.verification_uri !== 'string'
	) {
		throw new Error(
			'OttoRouter OAuth device authorization response was incomplete.',
		);
	}
	return {
		userCode: data.user_code,
		deviceCode: data.device_code,
		verificationUri: data.verification_uri,
		verificationUriComplete:
			typeof data.verification_uri_complete === 'string'
				? data.verification_uri_complete
				: undefined,
		interval: normalizeDeviceIntervalSeconds(data.interval),
		expiresIn:
			data.expires_in === undefined || data.expires_in === null
				? null
				: Number(data.expires_in),
	};
}

/** Poll the OttoRouter OAuth device token endpoint once. */
export async function pollOttoRouterDeviceCodeOnce(
	deviceCode: string,
): Promise<OttoRouterDevicePollResult> {
	const response = await fetch(`${ottorouterBaseUrl()}/api/auth/oauth2/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body: new URLSearchParams({
			client_id: OTTOROUTER_OAUTH_CLIENT_ID,
			device_code: deviceCode,
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			resource: ottorouterOAuthResource(),
		}).toString(),
	});
	const data = (await response.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	if (response.ok) {
		return { status: 'complete', tokens: normalizeTokens(data) };
	}
	const errorCode =
		typeof data.error === 'string' ? data.error : 'unknown_error';
	if (errorCode === 'authorization_pending' || errorCode === 'slow_down') {
		return { status: 'pending' };
	}
	if (errorCode === 'expired_token') {
		return { status: 'error', error: 'OttoRouter OAuth code expired.' };
	}
	if (errorCode === 'access_denied') {
		return { status: 'error', error: 'OttoRouter OAuth access denied.' };
	}
	const description =
		typeof data.error_description === 'string'
			? data.error_description
			: errorCode;
	return {
		status: 'error',
		error: `OttoRouter OAuth token polling failed: ${description}`,
	};
}

/** Refresh an OttoRouter OAuth access token using the refresh_token grant. */
export async function refreshOttoRouterToken(
	refreshToken: string,
): Promise<OttoRouterOAuthTokens> {
	const response = await fetch(`${ottorouterBaseUrl()}/api/auth/oauth2/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body: new URLSearchParams({
			client_id: OTTOROUTER_OAUTH_CLIENT_ID,
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			resource: ottorouterOAuthResource(),
		}).toString(),
	});
	const data = (await response.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	if (!response.ok) {
		const description =
			typeof data.error_description === 'string'
				? data.error_description
				: `HTTP ${response.status}`;
		if (response.status === 401 || response.status === 403) {
			throw new Error(
				`OttoRouter OAuth refresh token rejected (${description}). Run \`otto auth login ottorouter\` again.`,
			);
		}
		throw new Error(`OttoRouter OAuth token refresh failed: ${description}`);
	}
	return normalizeTokens(data, refreshToken);
}
