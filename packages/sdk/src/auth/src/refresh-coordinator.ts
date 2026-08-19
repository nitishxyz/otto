import type { OAuth, ProviderId } from '../../types/src/index.ts';
import { acquireFileLock } from './file-lock.ts';
import { getAuth, setAuthIfUnchanged } from './index.ts';

interface OAuthRefreshCoordinatorOptions<TTokens> {
	provider: ProviderId;
	projectRoot?: string;
	lockPath: string;
	refreshWindowMs: number;
	staleAccess?: string;
	refresh: (refreshToken: string) => Promise<TTokens>;
	isRotationRaceError: (error: unknown) => boolean;
	toOAuth: (tokens: TTokens, previous: OAuth) => OAuth;
	normalizeExpiresMs?: (expires: number) => number;
}

const inflightByProviderLock = new Map<string, Promise<OAuth | null>>();

function readOAuth(auth: Awaited<ReturnType<typeof getAuth>>): OAuth | null {
	if (auth?.type !== 'oauth' || !auth.access) return null;
	return auth;
}

function isFresh<TTokens>(
	auth: OAuth,
	options: OAuthRefreshCoordinatorOptions<TTokens>,
): boolean {
	if (options.staleAccess && auth.access === options.staleAccess) return false;
	const expires = options.normalizeExpiresMs
		? options.normalizeExpiresMs(auth.expires)
		: auth.expires;
	return !expires || expires >= Date.now() + options.refreshWindowMs;
}

async function readCurrent<TTokens>(
	options: OAuthRefreshCoordinatorOptions<TTokens>,
): Promise<OAuth | null> {
	return readOAuth(await getAuth(options.provider, options.projectRoot));
}

async function refreshUnderLock<TTokens>(
	options: OAuthRefreshCoordinatorOptions<TTokens>,
): Promise<OAuth | null> {
	const release = await acquireFileLock(options.lockPath);
	try {
		const current = await readCurrent(options);
		if (!current) return null;
		if (isFresh(current, options) || !current.refresh) return current;

		let refreshSource = current;
		let tokens: TTokens;
		try {
			tokens = await options.refresh(current.refresh);
		} catch (error) {
			const latest = await readCurrent(options);
			if (
				!latest?.refresh ||
				latest.refresh === current.refresh ||
				!options.isRotationRaceError(error)
			) {
				throw error;
			}
			if (isFresh(latest, options)) return latest;
			refreshSource = latest;
			tokens = await options.refresh(latest.refresh);
		}

		const next = options.toOAuth(tokens, refreshSource);
		const persisted = await setAuthIfUnchanged(
			options.provider,
			refreshSource,
			next,
			options.projectRoot,
			'global',
		);
		return persisted ? next : readCurrent(options);
	} finally {
		await release();
	}
}

/** Coordinate an OAuth refresh across callers and processes. */
export async function coordinateOAuthRefresh<TTokens>(
	options: OAuthRefreshCoordinatorOptions<TTokens>,
): Promise<OAuth | null> {
	const current = await readCurrent(options);
	if (!current) return null;
	if (isFresh(current, options) || !current.refresh) return current;

	const inflightKey = `${options.provider}\0${options.lockPath}`;
	const existing = inflightByProviderLock.get(inflightKey);
	if (existing) return existing;

	const operation = refreshUnderLock(options).finally(() => {
		inflightByProviderLock.delete(inflightKey);
	});
	inflightByProviderLock.set(inflightKey, operation);
	return operation;
}
