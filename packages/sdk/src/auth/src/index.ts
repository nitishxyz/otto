import { getSecureAuthPath, ensureDir } from '../../config/src/paths.ts';
import type { ProviderId, AuthInfo, AuthFile } from '../../types/src/index.ts';

export type {
	ProviderId,
	ApiAuth,
	OAuth,
	AuthInfo,
} from '../../types/src/index.ts';

function globalAuthPath(): string {
	return getSecureAuthPath();
}

let authMutation = Promise.resolve();

function mutateAuthFile(mutator: (auth: AuthFile) => void): Promise<void> {
	const mutation = authMutation.then(async () => {
		const path = globalAuthPath();
		const existing = ((await Bun.file(path)
			.json()
			.catch(() => ({}))) || {}) as AuthFile;
		mutator(existing);
		const base = path.slice(0, path.lastIndexOf('/')) || '.';
		await ensureDir(base);
		const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
		const { promises: fs } = await import('node:fs');
		try {
			await fs.writeFile(tempPath, JSON.stringify(existing, null, 2), {
				mode: 0o600,
			});
			await fs.rename(tempPath, path);
			await fs.chmod(path, 0o600).catch(() => {});
		} finally {
			await fs.rm(tempPath, { force: true }).catch(() => {});
		}
	});
	authMutation = mutation.catch(() => {});
	return mutation;
}

export async function getAllAuth(_projectRoot?: string): Promise<AuthFile> {
	const globalFile = Bun.file(globalAuthPath());
	const globalData = (await globalFile.json().catch(() => ({}))) as AuthFile;
	return { ...globalData };
}

export async function getAuth(
	provider: ProviderId,
	projectRoot?: string,
): Promise<AuthInfo | undefined> {
	const all = await getAllAuth(projectRoot);
	return all[provider];
}

export async function setAuth(
	provider: ProviderId,
	info: AuthInfo,
	_projectRoot?: string,
	_scope: 'global' | 'local' = 'global',
) {
	await mutateAuthFile((auth) => {
		auth[provider] = info;
	});
}

export async function removeAuth(
	provider: ProviderId,
	_projectRoot?: string,
	_scope: 'global' | 'local' = 'global',
) {
	await mutateAuthFile((auth) => {
		delete auth[provider];
	});
}

export {
	authorize,
	exchange,
	refreshToken,
	openAuthUrl,
	createApiKey,
	authorizeWeb,
	exchangeWeb,
} from './oauth.ts';

export {
	authorizeOpenAI,
	exchangeOpenAI,
	exchangeOpenAIDeviceCode,
	refreshOpenAIToken,
	openOpenAIAuthUrl,
	obtainOpenAIApiKey,
	pollOpenAIDeviceCodeOnce,
	requestOpenAIDeviceCode,
	authorizeOpenAIWeb,
	exchangeOpenAIWeb,
	type OpenAIDeviceCodeResponse,
	type OpenAIDevicePollResult,
	type OpenAIOAuthResult,
} from './openai-oauth.ts';

export {
	authorizeXai,
	exchangeXai,
	refreshXaiToken,
	openXaiAuthUrl,
	readGrokCliAuth,
	type XaiOAuthResult,
	type XaiOAuthTokens,
} from './xai-oauth.ts';

export {
	refreshKimiToken,
	requestKimiDeviceCode,
	pollKimiDeviceCodeOnce,
	type KimiOAuthTokens,
	type KimiDeviceCodeResponse,
	type KimiDevicePollResult,
} from './kimi-oauth.ts';

export {
	refreshOttoRouterToken,
	requestOttoRouterDeviceCode,
	pollOttoRouterDeviceCodeOnce,
	type OttoRouterOAuthTokens,
	type OttoRouterDeviceCodeResponse,
	type OttoRouterDevicePollResult,
} from './ottorouter-oauth.ts';

export {
	getFreshOttoRouterOAuth,
	type FreshOttoRouterOAuthOptions,
} from './ottorouter-refresh.ts';

export {
	generateWallet,
	importWallet,
	isValidPrivateKey,
	getOttoRouterWallet,
	ensureOttoRouterWallet,
	type WalletInfo,
} from './wallet.ts';

export {
	authorizeCopilot,
	pollForToken as pollForCopilotToken,
	pollForTokenOnce as pollForCopilotTokenOnce,
	openCopilotAuthUrl,
	type CopilotDeviceCodeResponse,
	type CopilotPollResult,
} from './copilot-oauth.ts';
