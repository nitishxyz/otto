import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

const XAI_OAUTH_ISSUER = 'https://auth.x.ai';
const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const XAI_OAUTH_SCOPE =
	'openid profile email offline_access grok-cli:access api:access';
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

export type XaiOAuthResult = {
	url: string;
	verifier: string;
	redirectUri: string;
	waitForCallback: () => Promise<string>;
	close: () => void;
};

function generatePKCE() {
	const verifier = randomBytes(32)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');

	const challenge = createHash('sha256')
		.update(verifier)
		.digest('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');

	return { verifier, challenge };
}

function generateState() {
	return randomBytes(32)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');
}

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

async function openBrowser(url: string) {
	const platform = process.platform;
	let command: string;

	switch (platform) {
		case 'darwin':
			command = `open "${url}"`;
			break;
		case 'win32':
			command = `start "${url}"`;
			break;
		default:
			command = `xdg-open "${url}"`;
			break;
	}

	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, [], { shell: true });
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`Failed to open browser (exit code ${code})`));
		});
	});
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
	const pkce = generatePKCE();
	const state = generateState();
	const nonce = generateState();
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
				<script>setTimeout(() => window.close(), 1500);</script>
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
