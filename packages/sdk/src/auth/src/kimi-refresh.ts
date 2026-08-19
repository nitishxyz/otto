import { getSecureAuthPath } from '../../config/src/paths.ts';
import type { OAuth } from '../../types/src/index.ts';
import { refreshKimiToken, type KimiOAuthTokens } from './kimi-oauth.ts';
import { coordinateOAuthRefresh } from './refresh-coordinator.ts';

const DEFAULT_REFRESH_WINDOW_MS = 5 * 60_000;

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

function normalizeExpiresMs(expires: number): number {
	if (!Number.isFinite(expires) || expires <= 0) return 0;
	return expires < 1_000_000_000_000 ? expires * 1000 : expires;
}

function isRefreshTokenRace(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /refresh token rejected|invalid_grant|revoked/i.test(message);
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
	const lockPath =
		options.lockPath ?? `${getSecureAuthPath()}.kimi-refresh.lock`;
	return coordinateOAuthRefresh({
		provider: 'kimi',
		projectRoot: options.projectRoot,
		lockPath,
		refreshWindowMs: options.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS,
		staleAccess: options.staleAccess,
		refresh: options.refreshFn ?? refreshKimiToken,
		isRotationRaceError: isRefreshTokenRace,
		toOAuth,
		normalizeExpiresMs,
	});
}
