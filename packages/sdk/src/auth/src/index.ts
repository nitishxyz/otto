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
	const path = globalAuthPath();
	const f = Bun.file(path);
	const existing = ((await f.json().catch(() => ({}))) || {}) as AuthFile;
	const next: AuthFile = { ...existing, [provider]: info };
	const base = path.slice(0, path.lastIndexOf('/')) || '.';
	await ensureDir(base);
	await Bun.write(path, JSON.stringify(next, null, 2));
	try {
		const { promises: fs } = await import('node:fs');
		await fs.chmod(path, 0o600).catch(() => {});
	} catch {}
}

export async function removeAuth(
	provider: ProviderId,
	_projectRoot?: string,
	_scope: 'global' | 'local' = 'global',
) {
	const path = globalAuthPath();
	const f = Bun.file(path);
	const existing = ((await f.json().catch(() => ({}))) || {}) as AuthFile;
	delete existing[provider];
	await Bun.write(path, JSON.stringify(existing, null, 2));
	try {
		const { promises: fs } = await import('node:fs');
		await fs.chmod(path, 0o600).catch(() => {});
	} catch {}
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
