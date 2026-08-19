import { openBrowser } from './open-browser';

const CLIENT_ID = 'Ov23lip6QjVYxHUAeW4d';
const POLLING_SAFETY_MARGIN_MS = 3000;

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

const COPILOT_DEFAULT_SCOPE = 'read:user';
const COPILOT_MCP_SCOPE =
	'repo read:org read:packages gist notifications read:project security_events';

export type CopilotDeviceCodeResponse = {
	verification_uri: string;
	user_code: string;
	device_code: string;
	interval: number;
};

export type CopilotOAuthResult = {
	access_token: string;
};

export async function requestDeviceCode(
	scope?: string,
): Promise<CopilotDeviceCodeResponse> {
	const response = await fetch(DEVICE_CODE_URL, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			client_id: CLIENT_ID,
			scope: scope ?? COPILOT_DEFAULT_SCOPE,
		}),
	});

	if (!response.ok) {
		throw new Error('Failed to initiate GitHub device authorization');
	}

	return (await response.json()) as CopilotDeviceCodeResponse;
}

export async function pollForToken(
	deviceCode: string,
	interval: number,
): Promise<string> {
	while (true) {
		const response = await fetch(ACCESS_TOKEN_URL, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				client_id: CLIENT_ID,
				device_code: deviceCode,
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			}),
		});

		if (!response.ok) {
			throw new Error('Token exchange request failed');
		}

		const data = (await response.json()) as {
			access_token?: string;
			error?: string;
			interval?: number;
		};

		if (data.access_token) {
			return data.access_token;
		}

		if (data.error === 'authorization_pending') {
			await Bun.sleep(interval * 1000 + POLLING_SAFETY_MARGIN_MS);
			continue;
		}

		if (data.error === 'slow_down') {
			let newInterval = (interval + 5) * 1000;
			const serverInterval = data.interval;
			if (
				serverInterval &&
				typeof serverInterval === 'number' &&
				serverInterval > 0
			) {
				newInterval = serverInterval * 1000;
			}
			await Bun.sleep(newInterval + POLLING_SAFETY_MARGIN_MS);
			continue;
		}

		if (data.error) {
			throw new Error(`GitHub OAuth error: ${data.error}`);
		}

		await Bun.sleep(interval * 1000 + POLLING_SAFETY_MARGIN_MS);
	}
}

export async function authorizeCopilot(options?: { mcp?: boolean }): Promise<{
	verificationUri: string;
	userCode: string;
	deviceCode: string;
	interval: number;
}> {
	const scope = options?.mcp ? COPILOT_MCP_SCOPE : COPILOT_DEFAULT_SCOPE;
	const deviceData = await requestDeviceCode(scope);
	return {
		verificationUri: deviceData.verification_uri,
		userCode: deviceData.user_code,
		deviceCode: deviceData.device_code,
		interval: deviceData.interval,
	};
}

export type CopilotPollResult =
	| { status: 'complete'; accessToken: string }
	| { status: 'pending' }
	| { status: 'error'; error: string };

export async function pollForTokenOnce(
	deviceCode: string,
): Promise<CopilotPollResult> {
	const response = await fetch(ACCESS_TOKEN_URL, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			client_id: CLIENT_ID,
			device_code: deviceCode,
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
		}),
	});

	if (!response.ok) {
		return { status: 'error', error: 'Token exchange request failed' };
	}

	const data = (await response.json()) as {
		access_token?: string;
		error?: string;
	};

	if (data.access_token) {
		return { status: 'complete', accessToken: data.access_token };
	}

	if (data.error === 'authorization_pending' || data.error === 'slow_down') {
		return { status: 'pending' };
	}

	if (data.error) {
		return { status: 'error', error: `GitHub OAuth error: ${data.error}` };
	}

	return { status: 'pending' };
}

export async function openCopilotAuthUrl(url: string): Promise<boolean> {
	try {
		await openBrowser(url);
		return true;
	} catch {
		return false;
	}
}
