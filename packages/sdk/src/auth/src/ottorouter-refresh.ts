import { getSecureAuthPath } from '../../config/src/paths.ts';
import type { OAuth } from '../../types/src/index.ts';
import { acquireFileLock } from './file-lock.ts';
import { getAuth, setAuthIfUnchanged } from './index.ts';
import {
	refreshOttoRouterToken,
	type OttoRouterOAuthTokens,
} from './ottorouter-oauth.ts';

/**
 * Refresh the access token this long before it expires so in-flight requests
 * never race the expiry boundary.
 */
const DEFAULT_REFRESH_WINDOW_MS = 5 * 60_000;
export interface FreshOttoRouterOAuthOptions {
	projectRoot?: string;
	/** Override the pre-expiry refresh window (defaults to 5 minutes). */
	refreshWindowMs?: number;
	/**
	 * Access token that was just rejected by the backend. Forces a refresh
	 * unless another process already persisted a different, still-fresh token.
	 */
	staleAccess?: string;
	/** Test hook: replaces the OttoRouter refresh_token HTTP exchange. */
	refreshFn?: typeof refreshOttoRouterToken;
	/** Test hook: overrides the cross-process lock file location. */
	lockPath?: string;
}

const inflightByLock = new Map<string, Promise<OAuth | null>>();

function isSessionRevokedError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /session not found|rejected|invalid_grant/i.test(message);
}

function readOttoRouterOAuth(
	auth: Awaited<ReturnType<typeof getAuth>>,
): OAuth | null {
	if (auth?.type !== 'oauth' || !auth.access) return null;
	return auth;
}

function isFresh(auth: OAuth, windowMs: number, staleAccess?: string): boolean {
	if (staleAccess && auth.access === staleAccess) return false;
	return !auth.expires || auth.expires >= Date.now() + windowMs;
}

function toOAuth(tokens: OttoRouterOAuthTokens, previous: OAuth): OAuth {
	return {
		type: 'oauth',
		access: tokens.access,
		refresh: tokens.refresh || previous.refresh,
		expires: tokens.expires,
		idToken: tokens.idToken ?? previous.idToken,
		scopes: tokens.scopes ?? previous.scopes,
	};
}

/**
 * Returns OttoRouter OAuth credentials that are valid for at least the
 * refresh window, refreshing and persisting them when needed.
 *
 * All refreshes are serialized through one in-process promise and one
 * cross-process file lock next to the auth file, so a rotating refresh token
 * is only ever exchanged once no matter how many otto processes (desktop
 * daemon, CLI, ACP) share the credentials. After acquiring the lock the auth
 * file is re-read: if another process already rotated the token, its result
 * is reused instead of re-consuming the old refresh token, which is what
 * previously caused intermittent "session not found" refresh failures.
 */
export async function getFreshOttoRouterOAuth(
	options: FreshOttoRouterOAuthOptions = {},
): Promise<OAuth | null> {
	const windowMs = options.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
	const current = readOttoRouterOAuth(
		await getAuth('ottorouter', options.projectRoot),
	);
	if (!current) return null;
	if (isFresh(current, windowMs, options.staleAccess)) return current;
	if (!current.refresh) return current;

	const lockPath =
		options.lockPath ?? `${getSecureAuthPath()}.ottorouter-refresh.lock`;
	const existing = inflightByLock.get(lockPath);
	if (existing) return existing;

	const operation = refreshUnderLock(lockPath, windowMs, options).finally(
		() => {
			inflightByLock.delete(lockPath);
		},
	);
	inflightByLock.set(lockPath, operation);
	return operation;
}

async function refreshUnderLock(
	lockPath: string,
	windowMs: number,
	options: FreshOttoRouterOAuthOptions,
): Promise<OAuth | null> {
	const refreshFn = options.refreshFn ?? refreshOttoRouterToken;
	const release = await acquireFileLock(lockPath);
	try {
		const current = readOttoRouterOAuth(
			await getAuth('ottorouter', options.projectRoot),
		);
		if (!current) return null;
		if (isFresh(current, windowMs, options.staleAccess)) return current;
		if (!current.refresh) return current;

		let refreshSource = current;
		let tokens: OttoRouterOAuthTokens;
		try {
			tokens = await refreshFn(current.refresh);
		} catch (error) {
			const latest = readOttoRouterOAuth(
				await getAuth('ottorouter', options.projectRoot),
			);
			if (
				!latest?.refresh ||
				latest.refresh === current.refresh ||
				!isSessionRevokedError(error)
			) {
				throw error;
			}
			if (isFresh(latest, windowMs, options.staleAccess)) return latest;
			refreshSource = latest;
			tokens = await refreshFn(latest.refresh);
		}

		const next = toOAuth(tokens, refreshSource);
		const persisted = await setAuthIfUnchanged(
			'ottorouter',
			refreshSource,
			next,
			options.projectRoot,
			'global',
		);
		if (persisted) return next;
		return readOttoRouterOAuth(
			await getAuth('ottorouter', options.projectRoot),
		);
	} finally {
		await release();
	}
}
