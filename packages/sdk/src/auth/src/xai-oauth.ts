import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openBrowser } from './open-browser';
import { createOAuthState, createPkcePair } from './oauth-primitives';

const XAI_OAUTH_ISSUER = 'https://auth.x.ai';
const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const XAI_OAUTH_SCOPE =
	'openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write';
const XAI_DEVICE_CODE_URL = `${XAI_OAUTH_ISSUER}/oauth2/device/code`;
const XAI_DEVICE_TOKEN_URL = `${XAI_OAUTH_ISSUER}/oauth2/token`;
const XAI_DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const XAI_GROK_CLIENT_VERSION = '1.0.3';
const XAI_DEVICE_POLL_INTERVAL_MS = 5_000;
const XAI_CALLBACK_HOST = '127.0.0.1';
const XAI_CALLBACK_PORT = 56121;
const XAI_CALLBACK_PATH = '/callback';
const XAI_REFRESH_SKEW_MS = 2 * 60 * 1000;
const XAI_GROK_CLI_AUTH_SCOPE_KEY = `${XAI_OAUTH_ISSUER}::${XAI_OAUTH_CLIENT_ID}`;
const XAI_GROK_CLI_LEGACY_AUTH_SCOPE_KEY = 'https://accounts.x.ai/sign-in';

type XaiDiscovery = {
	authorization_endpoint: string;
	token_endpoint: string;
};

type XaiTokenPayload = {
	access_token?: string;
	refresh_token?: string;
	id_token?: string;
	expires_in?: number;
	scope?: string;
	token_type?: string;
};

export type XaiOAuthTokens = {
	access: string;
	refresh: string;
	expires: number;
	idToken?: string;
	scopes?: string;
};

export type XaiDeviceAuthorization = {
	verificationUri: string;
	verificationUriComplete?: string;
	userCode: string;
	waitForTokens: () => Promise<XaiOAuthTokens>;
};

type XaiDeviceCodePayload = {
	device_code?: string;
	user_code?: string;
	verification_uri?: string;
	verification_uri_complete?: string;
	expires_in?: number;
	interval?: number;
};

type XaiDeviceTokenError = {
	error?: string;
	error_description?: string;
};

export type XaiOAuthResult = {
	url: string;
	verifier: string;
	redirectUri: string;
	waitForCallback: () => Promise<string>;
	close: () => void;
};

function validateXaiEndpoint(url: string): string {
	const parsed = new URL(url);
	const host = parsed.hostname.toLowerCase();
	if (
		parsed.protocol !== 'https:' ||
		(host !== 'x.ai' && !host.endsWith('.x.ai'))
	) {
		throw new Error(`xAI OAuth discovery returned unexpected endpoint: ${url}`);
	}
	return url;
}

async function discoverXaiOAuth(): Promise<XaiDiscovery> {
	const response = await fetch(XAI_OAUTH_DISCOVERY_URL, {
		headers: { Accept: 'application/json' },
	});
	if (!response.ok) {
		throw new Error(
			`xAI OAuth discovery failed: ${response.status} ${await response.text()}`,
		);
	}
	const data = (await response.json()) as Partial<XaiDiscovery>;
	if (!data.authorization_endpoint || !data.token_endpoint) {
		throw new Error('xAI OAuth discovery did not return auth/token endpoints');
	}
	return {
		authorization_endpoint: validateXaiEndpoint(data.authorization_endpoint),
		token_endpoint: validateXaiEndpoint(data.token_endpoint),
	};
}

function parseExpiry(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string' || !value.trim()) return undefined;
	const numeric = Number(value);
	if (Number.isFinite(numeric)) return numeric;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function tokensFromPayload(
	data: XaiTokenPayload,
	fallbackRefresh = '',
): XaiOAuthTokens {
	if (!data.access_token) {
		throw new Error('xAI token response did not include an access token');
	}
	const refresh = data.refresh_token || fallbackRefresh;
	if (!refresh) {
		throw new Error('xAI token response did not include a refresh token');
	}
	return {
		access: data.access_token,
		refresh,
		expires:
			Date.now() + (data.expires_in ?? 3600) * 1000 - XAI_REFRESH_SKEW_MS,
		idToken: data.id_token,
		scopes: data.scope,
	};
}

function getDeviceHeaders(): Record<string, string> {
	return {
		Accept: 'application/json',
		'Content-Type': 'application/x-www-form-urlencoded',
		'x-grok-client-surface': 'ui',
		'x-grok-client-version': XAI_GROK_CLIENT_VERSION,
	};
}

function validateVerificationUri(value: string): string {
	const parsed = new URL(value);
	const host = parsed.hostname.toLowerCase();
	if (
		parsed.protocol !== 'https:' ||
		(host !== 'x.ai' && !host.endsWith('.x.ai'))
	) {
		throw new Error(
			`xAI device authorization returned unexpected verification URL: ${value}`,
		);
	}
	return value;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollXaiDeviceTokens(args: {
	deviceCode: string;
	expiresIn: number;
	interval: number;
}): Promise<XaiOAuthTokens> {
	const deadline = Date.now() + args.expiresIn * 1000;
	let intervalMs = Math.max(1, args.interval) * 1000;

	while (Date.now() < deadline) {
		await delay(intervalMs);
		const response = await fetch(XAI_DEVICE_TOKEN_URL, {
			method: 'POST',
			headers: getDeviceHeaders(),
			body: new URLSearchParams({
				grant_type: XAI_DEVICE_GRANT_TYPE,
				device_code: args.deviceCode,
				client_id: XAI_OAUTH_CLIENT_ID,
			}).toString(),
		});

		if (response.ok) {
			return tokensFromPayload((await response.json()) as XaiTokenPayload);
		}

		const payload = (await response
			.json()
			.catch(() => ({}))) as XaiDeviceTokenError;
		const detail = payload.error_description || payload.error;
		switch (payload.error) {
			case 'authorization_pending':
				continue;
			case 'slow_down':
				intervalMs += XAI_DEVICE_POLL_INTERVAL_MS;
				continue;
			case 'access_denied':
				throw new Error('xAI device authorization was denied');
			case 'expired_token':
				throw new Error('xAI device authorization code expired');
			default:
				throw new Error(
					`xAI device token request failed: ${response.status}${detail ? ` ${detail}` : ''}`,
				);
		}
	}

	throw new Error('xAI device authorization code expired');
}

/** Start the xAI RFC 8628 device authorization flow used by Grok Build. */
export async function authorizeXaiDevice(): Promise<XaiDeviceAuthorization> {
	const response = await fetch(XAI_DEVICE_CODE_URL, {
		method: 'POST',
		headers: getDeviceHeaders(),
		body: new URLSearchParams({
			client_id: XAI_OAUTH_CLIENT_ID,
			scope: XAI_OAUTH_SCOPE,
			referrer: 'grok-build',
		}).toString(),
	});
	if (!response.ok) {
		throw new Error(
			`xAI device authorization failed: ${response.status} ${await response.text()}`,
		);
	}

	const payload = (await response.json()) as XaiDeviceCodePayload;
	if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
		throw new Error('xAI device authorization response was incomplete');
	}
	const verificationUri = validateVerificationUri(payload.verification_uri);
	const verificationUriComplete = payload.verification_uri_complete
		? validateVerificationUri(payload.verification_uri_complete)
		: `${verificationUri}${verificationUri.includes('?') ? '&' : '?'}user_code=${encodeURIComponent(payload.user_code)}`;

	return {
		verificationUri,
		verificationUriComplete,
		userCode: payload.user_code,
		waitForTokens: () =>
			pollXaiDeviceTokens({
				deviceCode: payload.device_code as string,
				expiresIn: payload.expires_in ?? 10 * 60,
				interval: payload.interval ?? XAI_DEVICE_POLL_INTERVAL_MS / 1000,
			}),
	};
}

async function exchangeXaiToken(
	body: Record<string, string>,
): Promise<XaiTokenPayload> {
	const discovery = await discoverXaiOAuth();
	const response = await fetch(discovery.token_endpoint, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams(body).toString(),
	});
	if (!response.ok) {
		throw new Error(
			`xAI token request failed: ${response.status} ${await response.text()}`,
		);
	}
	return (await response.json()) as XaiTokenPayload;
}

/** Start the xAI OAuth PKCE browser flow using a localhost callback. */
export async function authorizeXai(): Promise<XaiOAuthResult> {
	const discovery = await discoverXaiOAuth();
	const pkce = createPkcePair();
	const state = createOAuthState();
	const nonce = createOAuthState();
	const redirectUri = `http://${XAI_CALLBACK_HOST}:${XAI_CALLBACK_PORT}${XAI_CALLBACK_PATH}`;

	const params = new URLSearchParams({
		response_type: 'code',
		client_id: XAI_OAUTH_CLIENT_ID,
		redirect_uri: redirectUri,
		scope: XAI_OAUTH_SCOPE,
		code_challenge: pkce.challenge,
		code_challenge_method: 'S256',
		state,
		nonce,
	});
	const authUrl = `${discovery.authorization_endpoint}?${params.toString()}`;

	let resolveCallback: (code: string) => void;
	let rejectCallback: (error: Error) => void;
	const callbackPromise = new Promise<string>((resolve, reject) => {
		resolveCallback = resolve;
		rejectCallback = reject;
	});

	const server = createServer((req, res) => {
		const reqUrl = new URL(
			req.url || '/',
			`http://${XAI_CALLBACK_HOST}:${XAI_CALLBACK_PORT}`,
		);

		if (reqUrl.pathname !== XAI_CALLBACK_PATH) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}

		const code = reqUrl.searchParams.get('code');
		const returnedState = reqUrl.searchParams.get('state');
		const error = reqUrl.searchParams.get('error');
		const errorDescription = reqUrl.searchParams.get('error_description');

		if (error) {
			res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(
				`<html><body><h1>xAI authentication failed</h1><p>${errorDescription || error}</p></body></html>`,
			);
			rejectCallback(
				new Error(`xAI OAuth error: ${errorDescription || error}`),
			);
			return;
		}

		if (returnedState !== state) {
			res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(
				'<html><body><h1>Invalid State</h1><p>State mismatch. Please try again.</p></body></html>',
			);
			rejectCallback(new Error('xAI OAuth state mismatch'));
			return;
		}

		if (!code) {
			res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end('<html><body><h1>Missing Code</h1></body></html>');
			rejectCallback(new Error('No xAI authorization code received'));
			return;
		}

		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end(`
			<html>
			<head>
				<title>otto - xAI Connected</title>
				<style>
					body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #111827 0%, #374151 100%); color: white; }
					.container { text-align: center; padding: 2rem; background: rgba(255,255,255,0.1); border-radius: 16px; backdrop-filter: blur(10px); }
					.checkmark { font-size: 4rem; margin-bottom: 1rem; }
					h1 { margin: 0 0 0.5rem 0; }
					p { margin: 0; opacity: 0.9; }
				</style>
			</head>
			<body>
				<div class="container">
					<div class="checkmark">✓</div>
					<h1>xAI connected!</h1>
					<p>You can close this window.</p>
				</div>
				<script>
					setTimeout(() => {
						if (window.opener) window.opener.postMessage({ type: 'oauth-success', provider: 'xai' }, '*');
						setTimeout(() => window.close(), 500);
					}, 1500);
				</script>
			</body>
			</html>
		`);
		resolveCallback(code);
	});

	await new Promise<void>((resolve, reject) => {
		server.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				reject(
					new Error(
						`Port ${XAI_CALLBACK_PORT} is already in use. Stop any running Grok/xAI OAuth flow and try again.`,
					),
				);
			} else {
				reject(err);
			}
		});
		server.listen(XAI_CALLBACK_PORT, XAI_CALLBACK_HOST, () => resolve());
	});

	const timeoutMs = 5 * 60 * 1000;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<string>((_resolve, reject) => {
		timeoutId = setTimeout(() => {
			server.close();
			reject(new Error('xAI OAuth callback timeout'));
		}, timeoutMs);
	});

	const waitForCallback = () =>
		Promise.race([callbackPromise, timeoutPromise]).finally(() => {
			if (timeoutId) clearTimeout(timeoutId);
		});

	return {
		url: authUrl,
		verifier: pkce.verifier,
		redirectUri,
		waitForCallback,
		close: () => {
			if (timeoutId) clearTimeout(timeoutId);
			server.close();
		},
	};
}

/** Exchange an xAI OAuth authorization code for access and refresh tokens. */
export async function exchangeXai(
	code: string,
	verifier: string,
): Promise<XaiOAuthTokens> {
	const redirectUri = `http://${XAI_CALLBACK_HOST}:${XAI_CALLBACK_PORT}${XAI_CALLBACK_PATH}`;
	const data = await exchangeXaiToken({
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri,
		client_id: XAI_OAUTH_CLIENT_ID,
		code_verifier: verifier,
	});
	return tokensFromPayload(data);
}

/** Refresh an xAI OAuth access token. */
export async function refreshXaiToken(
	refreshToken: string,
): Promise<XaiOAuthTokens> {
	const data = await exchangeXaiToken({
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
		client_id: XAI_OAUTH_CLIENT_ID,
	});
	return tokensFromPayload(data, refreshToken);
}

/** Open the xAI OAuth authorization URL in the user's default browser. */
export async function openXaiAuthUrl(url: string) {
	try {
		await openBrowser(url);
		return true;
	} catch {
		return false;
	}
}

/** Read reusable OAuth credentials created by the official Grok CLI, if present. */
export function readGrokCliAuth(): XaiOAuthTokens | undefined {
	const authPath = join(homedir(), '.grok', 'auth.json');
	if (!existsSync(authPath)) return undefined;

	try {
		const data = JSON.parse(readFileSync(authPath, 'utf8')) as Record<
			string,
			Record<string, unknown>
		>;
		const oidc = data[XAI_GROK_CLI_AUTH_SCOPE_KEY];
		if (oidc) {
			const access = String(oidc.key || oidc.access_token || oidc.token || '');
			if (access) {
				return {
					access,
					refresh: String(oidc.refresh_token || oidc.refresh || ''),
					expires:
						(parseExpiry(oidc.expires_at) || Date.now() + 6 * 60 * 60 * 1000) -
						XAI_REFRESH_SKEW_MS,
					idToken: String(oidc.id_token || '') || undefined,
					scopes: String(oidc.scope || '') || undefined,
				};
			}
		}

		const legacy = data[XAI_GROK_CLI_LEGACY_AUTH_SCOPE_KEY];
		const legacyAccess = legacy
			? String(legacy.key || legacy.access_token || legacy.token || '')
			: '';
		if (legacyAccess) {
			return {
				access: legacyAccess,
				refresh: String(legacy?.refresh_token || legacy?.refresh || ''),
				expires:
					parseExpiry(legacy?.expires_at || legacy?.expires) ||
					Date.now() + 30 * 24 * 60 * 60 * 1000,
			};
		}
	} catch {
		return undefined;
	}
	return undefined;
}
