import { getSecureAuthPath } from '../../config/src/paths.ts';
import { refreshToken } from './oauth.ts';
import { coordinateOAuthRefresh } from './refresh-coordinator.ts';
import type { OAuth } from '../../types/src/index.ts';

export interface FreshAnthropicOAuthOptions {
	projectRoot?: string;
	refreshWindowMs?: number;
	/** Force refresh unless a different access token has already been saved. */
	staleAccess?: string;
	/** Test hook: replaces the refresh_token HTTP exchange. */
	refreshFn?: typeof refreshToken;
	/** Test hook: overrides the cross-process lock file location. */
	lockPath?: string;
}

/** Refresh stored Anthropic OAuth without racing token rotation or resurrecting logout. */
export async function getFreshAnthropicOAuth(
	options: FreshAnthropicOAuthOptions = {},
): Promise<OAuth | null> {
	return coordinateOAuthRefresh({
		provider: 'anthropic',
		projectRoot: options.projectRoot,
		lockPath:
			options.lockPath ?? `${getSecureAuthPath()}.anthropic-refresh.lock`,
		refreshWindowMs: options.refreshWindowMs ?? 5 * 60_000,
		staleAccess: options.staleAccess,
		refresh: options.refreshFn ?? refreshToken,
		isRotationRaceError: (error) =>
			(error instanceof Error ? error.message : String(error)).includes(
				'refresh token rejected',
			),
		toOAuth: (tokens, previous) => ({ ...previous, ...tokens, type: 'oauth' }),
	});
}
