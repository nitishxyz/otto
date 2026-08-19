import { createServer } from 'node:http';
import { openBrowser } from './open-browser';
import { createOAuthState, createPkcePair } from './oauth-primitives';

const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_ISSUER = 'https://auth.openai.com';
const OPENAI_CALLBACK_PORT = 1455;
const OPENAI_DEVICE_CALLBACK_URI = `${OPENAI_ISSUER}/deviceauth/callback`;
const OPENAI_DEVICE_AUTH_URL = `${OPENAI_ISSUER}/api/accounts/deviceauth`;
const OPENAI_DEVICE_VERIFICATION_URI = `${OPENAI_ISSUER}/codex/device`;

export type OpenAIOAuthResult = {
	url: string;
	verifier: string;
	waitForCallback: () => Promise<string>;
	close: () => void;
};

export type OpenAIDeviceCodeResponse = {
	verificationUri: string;
	userCode: string;
	deviceAuthId: string;
	interval: number;
};

export type OpenAIDevicePollResult =
	| {
			status: 'complete';
			code: string;
			codeVerifier: string;
			codeChallenge: string;
	  }
	| { status: 'pending' }
	| { status: 'error'; error: string };

function parseOpenAIDeviceInterval(interval: unknown): number {
	if (
		typeof interval === 'number' &&
		Number.isFinite(interval) &&
		interval > 0
	) {
		return interval;
	}
	if (typeof interval === 'string') {
		const parsed = Number.parseInt(interval, 10);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return 5;
}

function parseOpenAITokenPayload(accessToken: string): string | undefined {
	try {
		const payload = JSON.parse(
			Buffer.from(accessToken.split('.')[1], 'base64').toString(),
		);
		return payload['https://api.openai.com/auth']?.chatgpt_account_id;
	} catch {}
}

export async function requestOpenAIDeviceCode(): Promise<OpenAIDeviceCodeResponse> {
	const response = await fetch(`${OPENAI_DEVICE_AUTH_URL}/usercode`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			client_id: OPENAI_CLIENT_ID,
		}),
	});

	if (!response.ok) {
		const error = await response.text().catch(() => '');
		throw new Error(
			`Failed to initiate OpenAI device authorization${error ? `: ${error}` : ''}`,
		);
	}

	const data = (await response.json()) as {
		device_auth_id?: string;
		user_code?: string;
		usercode?: string;
		interval?: number | string;
	};

	const deviceAuthId = data.device_auth_id;
	const userCode = data.user_code ?? data.usercode;
	if (!deviceAuthId || !userCode) {
		throw new Error(
			'OpenAI device authorization response was missing code data',
		);
	}

	return {
		verificationUri: OPENAI_DEVICE_VERIFICATION_URI,
		userCode,
		deviceAuthId,
		interval: parseOpenAIDeviceInterval(data.interval),
	};
}

export async function pollOpenAIDeviceCodeOnce(
	deviceAuthId: string,
	userCode: string,
): Promise<OpenAIDevicePollResult> {
	const response = await fetch(`${OPENAI_DEVICE_AUTH_URL}/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			device_auth_id: deviceAuthId,
			user_code: userCode,
		}),
	});

	if (response.status === 403 || response.status === 404) {
		return { status: 'pending' };
	}

	if (!response.ok) {
		const error = await response.text().catch(() => '');
		return {
			status: 'error',
			error: `OpenAI device authorization failed${error ? `: ${error}` : ''}`,
		};
	}

	const data = (await response.json()) as {
		authorization_code?: string;
		code_verifier?: string;
		code_challenge?: string;
	};

	if (!data.authorization_code || !data.code_verifier || !data.code_challenge) {
		return {
			status: 'error',
			error: 'OpenAI device authorization response was missing token data',
		};
	}

	return {
		status: 'complete',
		code: data.authorization_code,
		codeVerifier: data.code_verifier,
		codeChallenge: data.code_challenge,
	};
}

export async function exchangeOpenAIDeviceCode(code: string, verifier: string) {
	return exchangeOpenAIWithRedirect(code, verifier, OPENAI_DEVICE_CALLBACK_URI);
}

async function exchangeOpenAIWithRedirect(
	code: string,
	verifier: string,
	redirectUri: string,
) {
	const response = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: OPENAI_CLIENT_ID,
			code_verifier: verifier,
		}).toString(),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Token exchange failed: ${error}`);
	}

	const json = (await response.json()) as {
		id_token: string;
		access_token: string;
		refresh_token: string;
		expires_in?: number;
	};

	return {
		idToken: json.id_token,
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + (json.expires_in || 3600) * 1000,
		accountId: parseOpenAITokenPayload(json.access_token),
	};
}

export async function authorizeOpenAI(): Promise<OpenAIOAuthResult> {
	const pkce = createPkcePair();
	const state = createOAuthState();
	const redirectUri = `http://localhost:${OPENAI_CALLBACK_PORT}/auth/callback`;

	const params = new URLSearchParams({
		response_type: 'code',
		client_id: OPENAI_CLIENT_ID,
		redirect_uri: redirectUri,
		scope: 'openid profile email offline_access',
		code_challenge: pkce.challenge,
		code_challenge_method: 'S256',
		id_token_add_organizations: 'true',
		codex_cli_simplified_flow: 'true',
		state: state,
		originator: 'codex_cli_rs',
	});

	const authUrl = `${OPENAI_ISSUER}/oauth/authorize?${params.toString()}`;

	let resolveCallback: (code: string) => void;
	let rejectCallback: (error: Error) => void;
	const callbackPromise = new Promise<string>((resolve, reject) => {
		resolveCallback = resolve;
		rejectCallback = reject;
	});

	const server = createServer((req, res) => {
		const reqUrl = new URL(
			req.url || '/',
			`http://localhost:${OPENAI_CALLBACK_PORT}`,
		);

		if (reqUrl.pathname === '/auth/callback') {
			const code = reqUrl.searchParams.get('code');
			const returnedState = reqUrl.searchParams.get('state');
			const error = reqUrl.searchParams.get('error');

			if (error) {
				res.writeHead(400, { 'Content-Type': 'text/html' });
				res.end(
					`<html><body><h1>Authentication Failed</h1><p>${error}</p></body></html>`,
				);
				rejectCallback(new Error(`OAuth error: ${error}`));
				return;
			}

			if (returnedState !== state) {
				res.writeHead(400, { 'Content-Type': 'text/html' });
				res.end(
					'<html><body><h1>Invalid State</h1><p>State mismatch. Please try again.</p></body></html>',
				);
				rejectCallback(new Error('State mismatch'));
				return;
			}

			if (code) {
				res.writeHead(200, { 'Content-Type': 'text/html' });
				res.end(`
					<html>
					<head>
						<title>otto - Authentication Successful</title>
						<style>
							body {
								font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
								display: flex;
								justify-content: center;
								align-items: center;
								height: 100vh;
								margin: 0;
								background: linear-gradient(135deg, #10a37f 0%, #1a7f5a 100%);
								color: white;
							}
							.container {
								text-align: center;
								padding: 2rem;
								background: rgba(255,255,255,0.1);
								border-radius: 16px;
								backdrop-filter: blur(10px);
							}
							.checkmark { font-size: 4rem; margin-bottom: 1rem; }
							h1 { margin: 0 0 0.5rem 0; }
							p { margin: 0; opacity: 0.9; }
						</style>
					</head>
					<body>
						<div class="container">
							<div class="checkmark">✓</div>
							<h1>Connected!</h1>
							<p>You can close this window.</p>
						</div>
						<script>
							// Delay to allow server to complete token exchange
							setTimeout(() => {
								if (window.opener) {
									window.opener.postMessage({ type: 'oauth-success', provider: 'openai' }, '*');
								}
								setTimeout(() => window.close(), 500);
							}, 1500);
						</script>
					</body>
					</html>
				`);
				resolveCallback(code);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/html' });
				res.end('<html><body><h1>Missing Code</h1></body></html>');
				rejectCallback(new Error('No authorization code received'));
			}
		} else {
			res.writeHead(404);
			res.end('Not found');
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				reject(
					new Error(
						`Port ${OPENAI_CALLBACK_PORT} is already in use. Make sure no other OAuth flow is running (including the official Codex CLI).`,
					),
				);
			} else {
				reject(err);
			}
		});
		server.listen(OPENAI_CALLBACK_PORT, '127.0.0.1', () => resolve());
	});

	const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	const timeoutPromise = new Promise<string>((_resolve, reject) => {
		timeoutId = setTimeout(() => {
			server.close();
			reject(new Error('OAuth callback timeout - authorization took too long'));
		}, OAUTH_TIMEOUT_MS);
	});

	const callbackWithTimeout = () =>
		Promise.race([callbackPromise, timeoutPromise]).finally(() => {
			if (timeoutId) clearTimeout(timeoutId);
		});

	return {
		url: authUrl,
		verifier: pkce.verifier,
		waitForCallback: callbackWithTimeout,
		close: () => {
			if (timeoutId) clearTimeout(timeoutId);
			server.close();
		},
	};
}

export async function exchangeOpenAI(code: string, verifier: string) {
	const redirectUri = `http://localhost:${OPENAI_CALLBACK_PORT}/auth/callback`;
	return exchangeOpenAIWithRedirect(code, verifier, redirectUri);
}

export async function refreshOpenAIToken(refreshToken: string) {
	const response = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: OPENAI_CLIENT_ID,
		}).toString(),
	});

	if (!response.ok) {
		throw new Error('Failed to refresh OpenAI token');
	}

	const json = (await response.json()) as {
		id_token?: string;
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};

	return {
		idToken: json.id_token,
		access: json.access_token || '',
		refresh: json.refresh_token || refreshToken,
		expires: Date.now() + (json.expires_in || 3600) * 1000,
	};
}

export async function openOpenAIAuthUrl(url: string) {
	try {
		await openBrowser(url);
		return true;
	} catch {
		return false;
	}
}

export async function obtainOpenAIApiKey(idToken: string): Promise<string> {
	const response = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
			client_id: OPENAI_CLIENT_ID,
			requested_token: 'openai-api-key',
			subject_token: idToken,
			subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
		}).toString(),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`API key exchange failed: ${error}`);
	}

	const json = (await response.json()) as {
		access_token: string;
	};

	return json.access_token;
}

export function authorizeOpenAIWeb(redirectUri: string): {
	url: string;
	verifier: string;
	state: string;
} {
	const pkce = createPkcePair();
	const state = createOAuthState();

	const params = new URLSearchParams({
		response_type: 'code',
		client_id: OPENAI_CLIENT_ID,
		redirect_uri: redirectUri,
		scope: 'openid profile email offline_access',
		code_challenge: pkce.challenge,
		code_challenge_method: 'S256',
		id_token_add_organizations: 'true',
		codex_cli_simplified_flow: 'true',
		state: state,
		originator: 'codex_cli_rs',
	});

	return {
		url: `${OPENAI_ISSUER}/oauth/authorize?${params.toString()}`,
		verifier: pkce.verifier,
		state,
	};
}

export async function exchangeOpenAIWeb(
	code: string,
	verifier: string,
	redirectUri: string,
) {
	return exchangeOpenAIWithRedirect(code, verifier, redirectUri);
}
