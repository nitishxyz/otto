import { getSecureAuthPath } from '../../config/src/paths.ts';
import type { OAuth } from '../../types/src/index.ts';
import { getAuth, setAuth } from './index.ts';
import {
	refreshOttoRouterToken,
	type OttoRouterOAuthTokens,
} from './ottorouter-oauth.ts';

/**
 * Refresh the access token this long before it expires so in-flight requests
 * never race the expiry boundary.
 */
const DEFAULT_REFRESH_WINDOW_MS = 5 * 60_000;
/** A crashed process' lock is considered stale after this long. */
const LOCK_STALE_MS = 30_000;
/** Maximum time to wait for another process' refresh before taking over. */
const LOCK_WAIT_MS = 20_000;
const LOCK_POLL_MS = 100;

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

async function loadFs(): Promise<typeof import('node:fs/promises')> {
	return import('node:fs/promises');
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
	const fs = await loadFs();
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (;;) {
		try {
			await fs.mkdir(lockPath, { recursive: false });
			break;
		} catch {
			if (Date.now() >= deadline) return async () => {};
			const stat = await fs.stat(lockPath).catch(() => null);
			if (!stat || stat.mtimeMs < Date.now() - LOCK_STALE_MS) {
				await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
				continue;
			}
			await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
		}
	}
	return async () => {
		await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
	};
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
	const release = await acquireLock(lockPath);
	try {
		const current = readOttoRouterOAuth(
			await getAuth('ottorouter', options.projectRoot),
		);
		if (!current) return null;
		if (isFresh(current, windowMs, options.staleAccess)) return current;
		if (!current.refresh) return current;

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
			tokens = await refreshFn(latest.refresh);
		}

		const next = toOAuth(tokens, current);
		await setAuth('ottorouter', next, options.projectRoot, 'global');
		return next;
	} finally {
		await release();
	}
}
