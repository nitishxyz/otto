import { getSecureAuthPath } from '../../config/src/paths.ts';
import type { OAuth } from '../../types/src/index.ts';
import { getAuth, setAuth } from './index.ts';
import { refreshKimiToken, type KimiOAuthTokens } from './kimi-oauth.ts';

const DEFAULT_REFRESH_WINDOW_MS = 5 * 60_000;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 20_000;
const LOCK_POLL_MS = 100;

export interface FreshKimiOAuthOptions {
	projectRoot?: string;
	/** Override the pre-expiry refresh window (defaults to 5 minutes). */
	refreshWindowMs?: number;
	/** Force refresh unless a different access token has already been saved. */
	staleAccess?: string;
	/** Test hook: replaces the Kimi refresh_token HTTP exchange. */
	refreshFn?: typeof refreshKimiToken;
	/** Test hook: overrides the cross-process lock file location. */
	lockPath?: string;
}

const inflightByLock = new Map<string, Promise<OAuth | null>>();

function normalizeExpiresMs(expires: number): number {
	if (!Number.isFinite(expires) || expires <= 0) return 0;
	return expires < 1_000_000_000_000 ? expires * 1000 : expires;
}

function isRefreshTokenRace(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /refresh token rejected|invalid_grant|revoked/i.test(message);
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
	const fs = await import('node:fs/promises');
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

function readKimiOAuth(
	auth: Awaited<ReturnType<typeof getAuth>>,
): OAuth | null {
	if (auth?.type !== 'oauth' || !auth.access) return null;
	return auth;
}

function isFresh(auth: OAuth, windowMs: number, staleAccess?: string): boolean {
	if (staleAccess && auth.access === staleAccess) return false;
	const expires = normalizeExpiresMs(auth.expires);
	return !expires || expires >= Date.now() + windowMs;
}

function toOAuth(tokens: KimiOAuthTokens, previous: OAuth): OAuth {
	return {
		type: 'oauth',
		access: tokens.access,
		refresh: tokens.refresh || previous.refresh,
		expires: tokens.expires,
		scopes: tokens.scopes ?? previous.scopes,
	};
}

/**
 * Returns a fresh Kimi OAuth token and persists refresh-token rotations.
 * Refreshes are serialized in-process and across processes because Kimi
 * invalidates each refresh token as soon as it is exchanged.
 */
export async function getFreshKimiOAuth(
	options: FreshKimiOAuthOptions = {},
): Promise<OAuth | null> {
	const windowMs = options.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
	const current = readKimiOAuth(await getAuth('kimi', options.projectRoot));
	if (!current) return null;
	if (isFresh(current, windowMs, options.staleAccess)) return current;
	if (!current.refresh) return current;

	const lockPath =
		options.lockPath ?? `${getSecureAuthPath()}.kimi-refresh.lock`;
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
	options: FreshKimiOAuthOptions,
): Promise<OAuth | null> {
	const refreshFn = options.refreshFn ?? refreshKimiToken;
	const release = await acquireLock(lockPath);
	try {
		const current = readKimiOAuth(await getAuth('kimi', options.projectRoot));
		if (!current) return null;
		if (isFresh(current, windowMs, options.staleAccess)) return current;
		if (!current.refresh) return current;

		let tokens: KimiOAuthTokens;
		try {
			tokens = await refreshFn(current.refresh);
		} catch (error) {
			const latest = readKimiOAuth(await getAuth('kimi', options.projectRoot));
			if (
				!latest?.refresh ||
				latest.refresh === current.refresh ||
				!isRefreshTokenRace(error)
			) {
				throw error;
			}
			if (isFresh(latest, windowMs, options.staleAccess)) return latest;
			tokens = await refreshFn(latest.refresh);
		}

		const next = toOAuth(tokens, current);
		await setAuth('kimi', next, options.projectRoot, 'global');
		return next;
	} finally {
		await release();
	}
}
