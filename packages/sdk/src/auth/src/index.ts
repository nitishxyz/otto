import { getSecureAuthPath } from '../../config/src/paths.ts';
import type { ProviderId, AuthInfo, AuthFile } from '../../types/src/index.ts';
import { isDeepStrictEqual } from 'node:util';
import { acquireFileLock } from './file-lock.ts';
import {
	atomicWriteJsonObject,
	readOptionalJsonObject,
} from '../../runtime/json-object-file.ts';

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

function mutateAuthFile<T>(mutator: (auth: AuthFile) => T): Promise<T> {
	const mutation = authMutation.then(async () => {
		const path = globalAuthPath();
		const release = await acquireFileLock(`${path}.lock`);
		try {
			const existing = ((await readOptionalJsonObject(path)) ?? {}) as AuthFile;
			const result = mutator(existing);
			await atomicWriteJsonObject(path, existing, { mode: 0o600 });
			return result;
		} finally {
			await release();
		}
	});
	authMutation = mutation.then(
		() => {},
		() => {},
	);
	return mutation;
}

export async function getAllAuth(_projectRoot?: string): Promise<AuthFile> {
	const globalData = ((await readOptionalJsonObject(globalAuthPath())) ??
		{}) as AuthFile;
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

/** Persist auth only when the provider entry still matches the caller's read. */
export async function setAuthIfUnchanged(
	provider: ProviderId,
	expected: AuthInfo | undefined,
	info: AuthInfo,
	_projectRoot?: string,
	_scope: 'global' | 'local' = 'global',
): Promise<boolean> {
	return mutateAuthFile((auth) => {
		if (!isDeepStrictEqual(auth[provider], expected)) return false;
		auth[provider] = info;
		return true;
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
	authorizeXaiDevice,
	exchangeXai,
	refreshXaiToken,
	openXaiAuthUrl,
	readGrokCliAuth,
	type XaiOAuthResult,
	type XaiOAuthTokens,
	type XaiDeviceAuthorization,
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
	getFreshKimiOAuth,
	type FreshKimiOAuthOptions,
} from './kimi-refresh.ts';

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
