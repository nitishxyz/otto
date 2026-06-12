const KIMI_CODE_OAUTH_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';

function kimiOAuthHost(): string {
	return (
		process.env.KIMI_CODE_OAUTH_HOST ??
		process.env.KIMI_OAUTH_HOST ??
		'https://auth.kimi.com'
	);
}

/** Kimi Code OAuth tokens normalized to otto's OAuth shape (expires in epoch ms). */
export type KimiOAuthTokens = {
	access: string;
	refresh: string;
	expires: number;
	scopes?: string;
};

/** Response from a Kimi Code OAuth device authorization request. */
export type KimiDeviceCodeResponse = {
	userCode: string;
	deviceCode: string;
	verificationUri: string;
	interval: number;
	expiresIn: number | null;
};

/** Result of a single Kimi device-code token poll attempt. */
export type KimiDevicePollResult =
	| { status: 'complete'; tokens: KimiOAuthTokens }
	| { status: 'pending' }
	| { status: 'error'; error: string };

/**
 * Request a Kimi Code OAuth device authorization code.
 *
 * Mirrors the kimi-cli device flow: form-encoded POST to
 * `https://auth.kimi.com/api/oauth/device_authorization` with `client_id`.
 */
export async function requestKimiDeviceCode(): Promise<KimiDeviceCodeResponse> {
	const response = await fetch(
		`${kimiOAuthHost().replace(/\/$/, '')}/api/oauth/device_authorization`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				client_id: KIMI_CODE_OAUTH_CLIENT_ID,
			}).toString(),
		},
	);
	const data = (await response.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	if (!response.ok) {
		throw new Error(
			`Kimi OAuth device authorization failed (${response.status})`,
		);
	}
	const userCode = data.user_code;
	const deviceCode = data.device_code;
	const verificationUriComplete = data.verification_uri_complete;
	if (
		typeof userCode !== 'string' ||
		typeof deviceCode !== 'string' ||
		typeof verificationUriComplete !== 'string'
	) {
		throw new Error('Kimi OAuth device authorization response was incomplete.');
	}
	return {
		userCode,
		deviceCode,
		verificationUri: verificationUriComplete,
		interval: Number(data.interval ?? 5),
		expiresIn:
			data.expires_in === undefined || data.expires_in === null
				? null
				: Number(data.expires_in),
	};
}

/**
 * Poll the Kimi Code OAuth token endpoint once for a device-code grant.
 *
 * Returns `pending` while authorization is outstanding (including
 * `slow_down`), `complete` with normalized tokens on success, and `error`
 * for terminal failures such as `expired_token` or `access_denied`.
 */
export async function pollKimiDeviceCodeOnce(
	deviceCode: string,
): Promise<KimiDevicePollResult> {
	const response = await fetch(
		`${kimiOAuthHost().replace(/\/$/, '')}/api/oauth/token`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				client_id: KIMI_CODE_OAUTH_CLIENT_ID,
				device_code: deviceCode,
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			}).toString(),
		},
	);
	const data = (await response.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	if (response.ok && typeof data.access_token === 'string') {
		const expiresIn = Number(data.expires_in ?? 0);
		return {
			status: 'complete',
			tokens: {
				access: data.access_token,
				refresh:
					typeof data.refresh_token === 'string' ? data.refresh_token : '',
				expires: Date.now() + expiresIn * 1000,
				scopes: typeof data.scope === 'string' ? data.scope : undefined,
			},
		};
	}
	const errorCode =
		typeof data.error === 'string' ? data.error : 'unknown_error';
	if (errorCode === 'authorization_pending' || errorCode === 'slow_down') {
		return { status: 'pending' };
	}
	if (errorCode === 'expired_token') {
		return { status: 'error', error: 'Kimi OAuth code expired.' };
	}
	if (errorCode === 'access_denied') {
		return { status: 'error', error: 'Kimi OAuth access denied.' };
	}
	return {
		status: 'error',
		error: `Kimi OAuth token polling failed: ${errorCode}`,
	};
}

/**
 * Refresh a Kimi Code OAuth access token using the refresh_token grant.
 *
 * Mirrors the official kimi-cli flow: form-encoded POST to
 * `https://auth.kimi.com/api/oauth/token` with `client_id`,
 * `grant_type=refresh_token`, and `refresh_token`. Kimi rotates refresh
 * tokens on every refresh, so callers must persist the returned tokens.
 */
export async function refreshKimiToken(
	refreshToken: string,
): Promise<KimiOAuthTokens> {
	const response = await fetch(
		`${kimiOAuthHost().replace(/\/$/, '')}/api/oauth/token`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				client_id: KIMI_CODE_OAUTH_CLIENT_ID,
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
			}).toString(),
		},
	);
	const data = (await response.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	if (!response.ok || typeof data.access_token !== 'string') {
		const description =
			typeof data.error_description === 'string'
				? data.error_description
				: `HTTP ${response.status}`;
		if (response.status === 401 || response.status === 403) {
			throw new Error(
				`Kimi OAuth refresh token rejected (${description}). Run \`otto auth login kimi\` again.`,
			);
		}
		throw new Error(`Kimi OAuth token refresh failed: ${description}`);
	}
	const expiresIn = Number(data.expires_in ?? 0);
	return {
		access: data.access_token,
		refresh:
			typeof data.refresh_token === 'string' && data.refresh_token
				? data.refresh_token
				: refreshToken,
		expires: Date.now() + expiresIn * 1000,
		scopes: typeof data.scope === 'string' ? data.scope : undefined,
	};
}
