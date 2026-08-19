import { openBrowser } from './open-browser';
import { createOAuthState, createPkcePair } from './oauth-primitives';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_CLI_VERSION = '1.0.61';
const OAUTH_TOKEN_ENDPOINT = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';

type Mode = 'max' | 'console';

export async function authorize(mode: Mode) {
	const pkce = createPkcePair();
	const state = createOAuthState();

	const url = new URL(
		`https://${mode === 'console' ? 'platform.claude.com' : 'claude.ai'}/oauth/authorize`,
	);
	url.searchParams.set('code', 'true');
	url.searchParams.set('client_id', CLIENT_ID);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
	url.searchParams.set(
		'scope',
		'org:create_api_key user:profile user:inference',
	);
	url.searchParams.set('code_challenge', pkce.challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('state', state);

	return {
		url: url.toString(),
		verifier: pkce.verifier,
	};
}

export async function exchange(code: string, verifier: string) {
	const splits = code.split('#');
	const result = await fetch(OAUTH_TOKEN_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			code: splits[0],
			state: splits[1],
			grant_type: 'authorization_code',
			client_id: CLIENT_ID,
			redirect_uri: OAUTH_REDIRECT_URI,
			code_verifier: verifier,
		}),
	});

	if (!result.ok) {
		const error = await result.text();
		throw new Error(`Token exchange failed: ${error}`);
	}

	const json = (await result.json()) as {
		refresh_token: string;
		access_token: string;
		expires_in: number;
	};
	return {
		refresh: json.refresh_token,
		access: json.access_token,
		expires: Date.now() + json.expires_in * 1000,
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function formatHttpStatus(response: Response): string {
	const statusText = response.statusText?.trim();
	return statusText
		? `HTTP ${response.status} ${statusText}`
		: `HTTP ${response.status}`;
}

function extractTokenRefreshErrorDescription(
	json: unknown,
	response: Response,
): string {
	const record = asRecord(json);
	if (!record) {
		if (typeof json === 'string' && json.trim()) {
			const preview = json.trim().replace(/\s+/g, ' ');
			return preview.length > 200 ? `${preview.slice(0, 200)}…` : preview;
		}
		return formatHttpStatus(response);
	}

	const errorDescription = readString(record.error_description);
	if (errorDescription) {
		return errorDescription.includes(`HTTP ${response.status}`)
			? errorDescription
			: `${errorDescription} (${formatHttpStatus(response)})`;
	}

	const errorField = record.error;
	const nestedError = asRecord(errorField);
	if (nestedError) {
		const message = readString(nestedError.message);
		const type = readString(nestedError.type);
		if (message && type) {
			return `${message} (${type}, ${formatHttpStatus(response)})`;
		}
		if (message) {
			return message.includes(`HTTP ${response.status}`)
				? message
				: `${message} (${formatHttpStatus(response)})`;
		}
		if (type) {
			return type.includes(`HTTP ${response.status}`)
				? type
				: `${type} (${formatHttpStatus(response)})`;
		}
	}

	const errorString = readString(errorField);
	if (errorString) {
		return errorString.includes(`HTTP ${response.status}`)
			? errorString
			: `${errorString} (${formatHttpStatus(response)})`;
	}

	const topMessage = readString(record.message);
	if (topMessage) {
		return topMessage.includes(`HTTP ${response.status}`)
			? topMessage
			: `${topMessage} (${formatHttpStatus(response)})`;
	}

	return formatHttpStatus(response);
}

function isRefreshTokenRejected(
	response: Response,
	description: string,
	json: unknown,
): boolean {
	if (response.status === 401 || response.status === 403) {
		return true;
	}

	const record = asRecord(json);
	const nestedError = asRecord(record?.error);
	const nestedType = readString(nestedError?.type);
	const nestedMessage = readString(nestedError?.message);
	const errorCode =
		readString(record?.error) ?? nestedType ?? readString(record?.type);
	const normalizedDescription = description.toLowerCase();

	if (errorCode === 'invalid_grant') {
		return true;
	}

	if (errorCode === 'not_found_error') {
		return true;
	}

	if (
		nestedType === 'not_found_error' ||
		nestedMessage?.toLowerCase() === 'not found'
	) {
		return true;
	}

	if (
		errorCode === 'invalid_request' &&
		/refresh[- ]?token/i.test(normalizedDescription)
	) {
		return true;
	}

	return false;
}

async function readTokenRefreshResponseBody(
	response: Response,
): Promise<unknown> {
	const body = await response.text();
	if (!body) {
		return {};
	}

	try {
		return JSON.parse(body) as unknown;
	} catch {
		return body;
	}
}

export async function refreshToken(refreshToken: string) {
	const response = await fetch(OAUTH_TOKEN_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json, text/plain, */*',
			'User-Agent': `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`,
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}).toString(),
	});
	const json = await readTokenRefreshResponseBody(response);
	const record = asRecord(json);
	const accessToken = readString(record?.access_token);

	if (!response.ok || !accessToken) {
		const description = extractTokenRefreshErrorDescription(json, response);
		if (isRefreshTokenRejected(response, description, json)) {
			throw new Error(
				`Claude OAuth refresh token rejected (${description}). Run \`otto auth login anthropic\` again.`,
			);
		}
		throw new Error(`Claude OAuth token refresh failed: ${description}`);
	}

	const expiresInRaw = record?.expires_in;
	const expiresInNumber =
		typeof expiresInRaw === 'number' ? expiresInRaw : Number(expiresInRaw);
	const expiresIn =
		Number.isFinite(expiresInNumber) && expiresInNumber > 0
			? expiresInNumber
			: 3600;

	return {
		refresh: readString(record?.refresh_token) || refreshToken,
		access: accessToken,
		expires: Date.now() + expiresIn * 1000,
	};
}

export async function openAuthUrl(url: string) {
	try {
		await openBrowser(url);
		return true;
	} catch {
		return false;
	}
}

export async function createApiKey(accessToken: string) {
	const result = await fetch(
		'https://api.anthropic.com/api/oauth/claude_cli/create_api_key',
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				authorization: `Bearer ${accessToken}`,
			},
		},
	);

	if (!result.ok) {
		const error = await result.text();
		throw new Error(`Failed to create API key: ${error}`);
	}

	const json = (await result.json()) as { raw_key: string };
	return json.raw_key;
}

export function authorizeWeb(mode: Mode, redirectUri: string) {
	const pkce = createPkcePair();
	const state = createOAuthState();

	const url = new URL(
		`https://${mode === 'console' ? 'platform.claude.com' : 'claude.ai'}/oauth/authorize`,
	);
	url.searchParams.set('code', 'true');
	url.searchParams.set('client_id', CLIENT_ID);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set(
		'scope',
		'org:create_api_key user:profile user:inference',
	);
	url.searchParams.set('code_challenge', pkce.challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('state', state);

	return {
		url: url.toString(),
		verifier: pkce.verifier,
	};
}

export async function exchangeWeb(
	code: string,
	verifier: string,
	redirectUri: string,
) {
	const splits = code.split('#');
	const result = await fetch(OAUTH_TOKEN_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			code: splits[0],
			state: splits[1],
			grant_type: 'authorization_code',
			client_id: CLIENT_ID,
			redirect_uri: redirectUri,
			code_verifier: verifier,
		}),
	});

	if (!result.ok) {
		const error = await result.text();
		throw new Error(`Token exchange failed: ${error}`);
	}

	const json = (await result.json()) as {
		refresh_token: string;
		access_token: string;
		expires_in: number;
	};
	return {
		refresh: json.refresh_token,
		access: json.access_token,
		expires: Date.now() + json.expires_in * 1000,
	};
}
