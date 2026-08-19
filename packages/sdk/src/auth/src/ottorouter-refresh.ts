import { getSecureAuthPath } from '../../config/src/paths.ts';
import type { OAuth } from '../../types/src/index.ts';
import {
	refreshOttoRouterToken,
	type OttoRouterOAuthTokens,
} from './ottorouter-oauth.ts';
import { coordinateOAuthRefresh } from './refresh-coordinator.ts';

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

function isSessionRevokedError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /session not found|rejected|invalid_grant/i.test(message);
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
	const lockPath =
		options.lockPath ?? `${getSecureAuthPath()}.ottorouter-refresh.lock`;
	return coordinateOAuthRefresh({
		provider: 'ottorouter',
		projectRoot: options.projectRoot,
		lockPath,
		refreshWindowMs: options.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS,
		staleAccess: options.staleAccess,
		refresh: options.refreshFn ?? refreshOttoRouterToken,
		isRotationRaceError: isSessionRevokedError,
		toOAuth,
	});
}
