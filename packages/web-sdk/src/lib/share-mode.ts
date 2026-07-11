// Share-mode boot handling.
//
// A project share URL looks like `https://device.example/?share=<token>`.
// When a viewer opens that URL we must:
//   1. Store the share token as a *distinct* credential (never the daemon
//      server token) so it is attached to API calls.
//   2. Strip `?share=` from the address bar so the token is not leaked into
//      history, referrers, or copied URLs.
//   3. Mark the session as share-scoped so owner-only controls are hidden and
//      the project context is pinned server-side by the token.
//
// The share credential is intentionally kept in `sessionStorage` (per-tab,
// cleared on close) rather than `localStorage`, and separate from the daemon
// `serverToken`, so a share viewer never gains owner-level access.

export const SHARE_TOKEN_HEADER = 'X-Otto-Share-Token';
export const SHARE_TOKEN_STORAGE_KEY = 'otto-share-token';
export const SHARE_PROJECT_ID_STORAGE_KEY = 'otto-share-project-id';
export const SHARE_QUERY_PARAM = 'share';

interface ShareModeWindow extends Window {
	__OTTO_SHARE_TOKEN__?: string;
	__OTTO_SHARE_PROJECT_ID__?: string | null;
}

function shareWindow(): ShareModeWindow | undefined {
	if (typeof window === 'undefined') return undefined;
	return window as ShareModeWindow;
}

function readSessionStorage(key: string): string | undefined {
	if (typeof window === 'undefined') return undefined;
	try {
		return window.sessionStorage.getItem(key) ?? undefined;
	} catch {
		return undefined;
	}
}

function writeSessionStorage(key: string, value: string): void {
	if (typeof window === 'undefined') return;
	try {
		window.sessionStorage.setItem(key, value);
	} catch {
		// Ignore storage errors; the in-memory value still works this page load.
	}
}

function removeSessionStorage(key: string): void {
	if (typeof window === 'undefined') return;
	try {
		window.sessionStorage.removeItem(key);
	} catch {
		// Ignore storage errors.
	}
}

/** Returns the active share token, if the current tab is in share mode. */
export function getShareToken(): string | undefined {
	const win = shareWindow();
	if (win?.__OTTO_SHARE_TOKEN__) return win.__OTTO_SHARE_TOKEN__;
	const stored = readSessionStorage(SHARE_TOKEN_STORAGE_KEY);
	if (stored && win) win.__OTTO_SHARE_TOKEN__ = stored;
	return stored;
}

/** True when the current tab was booted from a `?share=` project share link. */
export function isShareMode(): boolean {
	return Boolean(getShareToken());
}

/**
 * Returns the project id a share is pinned to, once it has been resolved from
 * the server. Returns undefined until resolution completes.
 */
export function getSharePinnedProjectId(): string | undefined {
	const win = shareWindow();
	if (win && typeof win.__OTTO_SHARE_PROJECT_ID__ === 'string') {
		return win.__OTTO_SHARE_PROJECT_ID__ ?? undefined;
	}
	return readSessionStorage(SHARE_PROJECT_ID_STORAGE_KEY);
}

/** Persists the resolved pinned project id for the active share. */
export function setSharePinnedProjectId(projectId: string): void {
	const win = shareWindow();
	if (win) win.__OTTO_SHARE_PROJECT_ID__ = projectId;
	writeSessionStorage(SHARE_PROJECT_ID_STORAGE_KEY, projectId);
}

/** Activates share mode with an explicitly supplied project-share token. */
export function activateShareMode(token: string): void {
	const normalized = token.trim();
	if (!normalized) {
		clearShareMode();
		return;
	}
	const win = shareWindow();
	if (win) {
		win.__OTTO_SHARE_TOKEN__ = normalized;
		delete win.__OTTO_SHARE_PROJECT_ID__;
	}
	writeSessionStorage(SHARE_TOKEN_STORAGE_KEY, normalized);
	removeSessionStorage(SHARE_PROJECT_ID_STORAGE_KEY);
}

/** Clears all share credentials for the current tab. */
export function clearShareMode(): void {
	const win = shareWindow();
	if (win) {
		delete win.__OTTO_SHARE_TOKEN__;
		delete win.__OTTO_SHARE_PROJECT_ID__;
	}
	removeSessionStorage(SHARE_TOKEN_STORAGE_KEY);
	removeSessionStorage(SHARE_PROJECT_ID_STORAGE_KEY);
}

/** Builds the share auth header when a share token is active. */
export function getShareAuthHeaders(): Record<string, string> {
	const token = getShareToken();
	return token ? { [SHARE_TOKEN_HEADER]: token } : {};
}

/**
 * Consumes a `?share=<token>` boot parameter: stores the token as a distinct
 * share credential and strips it from the URL. Safe to call multiple times and
 * on non-browser environments. Returns the token when share mode is (or was
 * already) active for this tab.
 */
export function consumeShareBoot(): string | undefined {
	if (typeof window === 'undefined') return undefined;

	let token: string | undefined;
	try {
		const url = new URL(window.location.href);
		const param = url.searchParams.get(SHARE_QUERY_PARAM);
		if (param) {
			token = param.trim() || undefined;
			if (token) activateShareMode(token);
			url.searchParams.delete(SHARE_QUERY_PARAM);
			const search = url.searchParams.toString();
			const stripped = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
			try {
				window.history.replaceState({}, '', stripped);
			} catch {
				// Ignore history errors (e.g. sandboxed iframe).
			}
		}
	} catch {
		// Ignore URL parsing errors.
	}

	return token ?? getShareToken();
}
