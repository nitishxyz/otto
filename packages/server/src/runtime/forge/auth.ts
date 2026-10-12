import {
	authorizeCopilot,
	exchangeOpenAIDeviceCode,
	getAllAuth,
	isBuiltInProviderId,
	isProviderAuthorized,
	loadConfig,
	logger,
	pollForCopilotTokenOnce,
	pollKimiDeviceCodeOnce,
	pollOttoRouterDeviceCodeOnce,
	pollOpenAIDeviceCodeOnce,
	removeAuth,
	requestKimiDeviceCode,
	requestOttoRouterDeviceCode,
	requestOpenAIDeviceCode,
	setAuth,
	type ProviderId,
} from '@ottocode/sdk';
import { stopTunnel } from '../../routes/tunnel/service.ts';
import { getServerPort } from '../../state.ts';
import type { ForgeInput } from './types.ts';

const DEVICE_FLOW_TIMEOUT_MS = 15 * 60 * 1000;

function authProvider(input: ForgeInput): ProviderId {
	const provider = input.name?.trim().toLowerCase();
	if (!provider) throw new Error('name is required for auth actions');
	if (!isBuiltInProviderId(provider)) {
		throw new Error(
			`Provider '${provider}' does not support managed authentication`,
		);
	}
	return provider;
}

async function authStatus(projectRoot: string, provider: ProviderId) {
	const config = await loadConfig(projectRoot);
	const auth = (await getAllAuth(projectRoot))[provider];
	return {
		provider,
		authorized: await isProviderAuthorized(config, provider),
		stored: Boolean(auth),
		type: auth?.type,
		...(auth?.type === 'oauth'
			? {
					expires: auth.expires,
					expired:
						typeof auth.expires === 'number'
							? auth.expires <= Date.now()
							: false,
					scopes: auth.scopes,
					accountId: auth.accountId,
				}
			: {}),
	};
}

export async function listForgeAuth(projectRoot: string) {
	const auth = await getAllAuth(projectRoot);
	return Promise.all(
		Object.keys(auth).map((provider) => authStatus(projectRoot, provider)),
	);
}

/** A poll either stays pending or yields the credential write to commit. */
type DevicePollResult = 'pending' | (() => Promise<void>);

type DeviceSession = {
	id: string;
	cancelled: boolean;
	timer?: ReturnType<typeof setTimeout>;
	committing?: Promise<void>;
};

/** Active device-poll sessions keyed by credential identity. */
const deviceSessions = new Map<string, DeviceSession>();

function deviceIdentity(provider: ProviderId): string {
	return `global:${provider}`;
}

/**
 * Cancels the active device flow for a credential identity and waits for an
 * in-flight credential write to settle, so a later logout cannot be undone by
 * a stale flow.
 */
export async function cancelForgeDeviceFlow(
	provider: ProviderId,
): Promise<boolean> {
	const key = deviceIdentity(provider);
	const session = deviceSessions.get(key);
	if (!session) return false;
	session.cancelled = true;
	if (session.timer) clearTimeout(session.timer);
	deviceSessions.delete(key);
	await session.committing?.catch(() => {});
	return true;
}

async function scheduleDevicePolling(
	provider: ProviderId,
	intervalSeconds: number,
	poll: () => Promise<DevicePollResult>,
): Promise<void> {
	await cancelForgeDeviceFlow(provider);
	const key = deviceIdentity(provider);
	const session: DeviceSession = { id: crypto.randomUUID(), cancelled: false };
	deviceSessions.set(key, session);
	const startedAt = Date.now();
	const finish = () => {
		if (deviceSessions.get(key) === session) deviceSessions.delete(key);
	};
	const schedule = () => {
		if (session.cancelled) return;
		session.timer = setTimeout(
			() => void run(),
			Math.max(intervalSeconds, 1) * 1000,
		);
	};
	const run = async () => {
		if (session.cancelled) return;
		if (Date.now() - startedAt >= DEVICE_FLOW_TIMEOUT_MS) {
			logger.warn(`${provider} OAuth device flow timed out`);
			finish();
			return;
		}
		try {
			const result = await poll();
			if (session.cancelled) return;
			if (result === 'pending') {
				schedule();
				return;
			}
			session.committing = result();
			await session.committing;
			finish();
		} catch (error) {
			logger.error(`${provider} OAuth device flow failed`, error);
			finish();
		}
	};
	schedule();
}

async function startOpenAIDeviceFlow(projectRoot: string) {
	const device = await requestOpenAIDeviceCode();
	await scheduleDevicePolling('openai', device.interval, async () => {
		const result = await pollOpenAIDeviceCodeOnce(
			device.deviceAuthId,
			device.userCode,
		);
		if (result.status === 'pending') return 'pending';
		if (result.status === 'error') throw new Error(result.error);
		const tokens = await exchangeOpenAIDeviceCode(
			result.code,
			result.codeVerifier,
		);
		return () =>
			setAuth(
				'openai',
				{
					type: 'oauth',
					refresh: tokens.refresh,
					access: tokens.access,
					expires: tokens.expires,
					accountId: tokens.accountId,
					idToken: tokens.idToken,
				},
				projectRoot,
				'global',
			);
	});
	return {
		provider: 'openai',
		method: 'oauth',
		mode: 'device',
		authUrl: device.verificationUri,
		userCode: device.userCode,
	};
}

async function startOttoRouterDeviceFlow(projectRoot: string) {
	const device = await requestOttoRouterDeviceCode();
	await scheduleDevicePolling('ottorouter', device.interval, async () => {
		const result = await pollOttoRouterDeviceCodeOnce(device.deviceCode);
		if (result.status === 'pending') return 'pending';
		if (result.status === 'error') throw new Error(result.error);
		return () =>
			setAuth(
				'ottorouter',
				{ type: 'oauth', ...result.tokens },
				projectRoot,
				'global',
			);
	});
	return {
		provider: 'ottorouter',
		method: 'oauth',
		mode: 'device',
		authUrl: device.verificationUriComplete ?? device.verificationUri,
		userCode: device.userCode,
	};
}

async function startKimiDeviceFlow(projectRoot: string) {
	const device = await requestKimiDeviceCode();
	await scheduleDevicePolling('kimi', device.interval, async () => {
		const result = await pollKimiDeviceCodeOnce(device.deviceCode);
		if (result.status === 'pending') return 'pending';
		if (result.status === 'error') throw new Error(result.error);
		return () =>
			setAuth(
				'kimi',
				{ type: 'oauth', ...result.tokens },
				projectRoot,
				'global',
			);
	});
	return {
		provider: 'kimi',
		method: 'oauth',
		mode: 'device',
		authUrl: device.verificationUri,
		userCode: device.userCode,
	};
}

async function startCopilotDeviceFlow(projectRoot: string) {
	const device = await authorizeCopilot();
	await scheduleDevicePolling('copilot', device.interval, async () => {
		const result = await pollForCopilotTokenOnce(device.deviceCode);
		if (result.status === 'pending') return 'pending';
		if (result.status === 'error') throw new Error(result.error);
		return () =>
			setAuth(
				'copilot',
				{ type: 'api', key: result.accessToken },
				projectRoot,
				'global',
			);
	});
	return {
		provider: 'copilot',
		method: 'oauth',
		mode: 'device',
		authUrl: device.verificationUri,
		userCode: device.userCode,
	};
}

async function startOAuth(
	projectRoot: string,
	provider: ProviderId,
	input: ForgeInput,
) {
	if (provider === 'openai' && input.oauthMode === 'device') {
		return startOpenAIDeviceFlow(projectRoot);
	}
	if (provider === 'ottorouter') return startOttoRouterDeviceFlow(projectRoot);
	if (provider === 'kimi') return startKimiDeviceFlow(projectRoot);
	if (provider === 'copilot') return startCopilotDeviceFlow(projectRoot);
	if (provider === 'anthropic' || provider === 'openai' || provider === 'xai') {
		if (input.oauthMode === 'device') {
			throw new Error(
				`${provider} does not support device OAuth through Forge`,
			);
		}
		const port = getServerPort() ?? 9100;
		const authUrl = `http://127.0.0.1:${port}/v1/auth/${provider}/oauth/start`;
		return { provider, method: 'oauth', mode: 'browser', authUrl };
	}
	throw new Error(`OAuth is not supported for provider '${provider}'`);
}

export async function runForgeAuthAction(
	projectRoot: string,
	input: ForgeInput,
) {
	const provider = authProvider(input);
	if (input.action === 'status') {
		return { ok: true, auth: await authStatus(projectRoot, provider) };
	}
	if (input.action === 'logout' || input.action === 'remove') {
		const plan = {
			action: 'logout',
			target: {
				kind: 'auth' as const,
				scope: 'global' as const,
				name: provider,
				paths: [],
			},
			exists: (await getAllAuth(projectRoot))[provider] !== undefined,
			changes: [`Remove stored ${provider} credentials`],
		};
		if (input.dryRun) return { ok: true, applied: false, plan };
		await cancelForgeDeviceFlow(provider);
		if (provider === 'ottorouter') {
			await stopTunnel({ mode: 'managed', scope: 'remote-control' });
		}
		await removeAuth(provider, projectRoot, 'global');
		return {
			ok: true,
			applied: true,
			plan,
			auth: await authStatus(projectRoot, provider),
		};
	}
	if (input.action !== 'authenticate' && input.action !== 'reauthenticate') {
		throw new Error(
			'Auth supports status, authenticate, reauthenticate, logout, or remove',
		);
	}

	const method = input.authMethod ?? (input.apiKey ? 'api-key' : 'oauth');
	if (input.dryRun) {
		return {
			ok: true,
			applied: false,
			plan: {
				action: input.action,
				target: {
					kind: 'auth' as const,
					scope: 'global' as const,
					name: provider,
					paths: [],
				},
				exists: (await getAllAuth(projectRoot))[provider] !== undefined,
				changes: [`${input.action} ${provider} with ${method}`],
			},
		};
	}
	if (method === 'api-key') {
		if (!input.apiKey)
			throw new Error('apiKey is required for API-key authentication');
		await cancelForgeDeviceFlow(provider);
		await setAuth(
			provider,
			{ type: 'api', key: input.apiKey },
			projectRoot,
			'global',
		);
		return {
			ok: true,
			applied: true,
			auth: await authStatus(projectRoot, provider),
		};
	}
	return {
		ok: true,
		applied: true,
		auth: await startOAuth(projectRoot, provider, input),
	};
}
