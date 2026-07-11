// Owner-auth gate.
//
// The daemon serves the UI same-origin. Locally, owner (full-access) requests
// are authenticated with the persistent daemon `serverToken`, which the daemon
// injects into `OTTO_RUNTIME_CONTEXT` when it renders the page locally.
//
// Over a managed tunnel, an owner can gain full access without ever reading,
// copying, or transmitting `~/.otto/server-token` via the setu device-owner
// authorization exchange:
//
//   1. Ask the same-origin daemon for a one-time challenge
//      (`POST /v1/tunnel/owner/challenge`).
//   2. Obtain a short-lived signed assertion for that challenge from OttoRouter
//      (setu), proving the OAuth subject owns this tunnel device.
//   3. Exchange the assertion for a Secure, HttpOnly owner session cookie
//      (`POST /v1/tunnel/owner/session`), which the browser then sends
//      automatically on same-origin API calls.
//
// The browser does NOT hold the OttoRouter OAuth token: only a party that
// securely possesses it (the desktop shell, or a future redirect/connect flow)
// can mint the assertion in step 2. This module therefore supports two entry
// points:
//
//   - `authorizeOwnerWithAssertion(assertion)`: an assertion-holder (desktop /
//     redirect flow) drives the full challenge -> exchange -> cookie flow.
//   - Desktop-supplied session: the desktop shell exchanges the assertion in
//     its Rust backend and hands the resulting memory-only owner-session bearer
//     to the browser through `OTTO_RUNTIME_CONTEXT.ownerSession`. That bearer is
//     attached to remote requests as `X-Otto-Owner-Session`.
//
// When neither an assertion source nor a desktop session is available, owner
// authorization stays gracefully `unavailable` rather than inventing insecure
// auth. The owner session is memory-only and window-scoped; it is never written
// to disk, URL, or persistent web storage.

import {
	createTunnelOwnerChallenge,
	createTunnelOwnerSession,
} from '@ottocode/api';
import { getRuntimeProjectContext } from './config';
import { isShareMode } from './share-mode';

export const OWNER_SESSION_HEADER = 'X-Otto-Owner-Session';

export type OwnerAuthState =
	| { status: 'owner' }
	| { status: 'share' }
	| { status: 'unauthenticated' };

export type OwnerAuthorizationResult =
	| { ok: true; expiresAt: number | null }
	| { ok: false; reason: 'unavailable'; message: string }
	| {
			ok: false;
			reason: 'error';
			code: string;
			status?: number;
			message: string;
	  };

interface OwnerSession {
	token: string;
	expiresAt: number | null;
}

// Memory-only, window-scoped owner session established by an assertion exchange
// in this tab. Never persisted.
let inMemorySession: OwnerSession | null = null;

// Optional listeners notified whenever the owner session changes so the API
// client can re-apply auth headers without introducing an import cycle.
const sessionListeners = new Set<() => void>();

/** Subscribes to owner-session changes; returns an unsubscribe function. */
export function onOwnerSessionChange(listener: () => void): () => void {
	sessionListeners.add(listener);
	return () => sessionListeners.delete(listener);
}

function notifySessionChange(): void {
	for (const listener of sessionListeners) {
		try {
			listener();
		} catch {
			// Listener failures must not break the auth flow.
		}
	}
}

function now(): number {
	return Date.now();
}

function sessionExpiry(expiresInSeconds: number | undefined): number | null {
	if (
		typeof expiresInSeconds !== 'number' ||
		!Number.isFinite(expiresInSeconds)
	)
		return null;
	return now() + expiresInSeconds * 1000;
}

function isLive(session: OwnerSession | null): session is OwnerSession {
	if (!session) return false;
	if (session.expiresAt == null) return true;
	return session.expiresAt > now();
}

function desktopSuppliedSession(): OwnerSession | null {
	const supplied = getRuntimeProjectContext()?.ownerSession;
	if (!supplied?.token) return null;
	return {
		token: supplied.token,
		expiresAt:
			typeof supplied.expiresAt === 'number' ? supplied.expiresAt : null,
	};
}

/**
 * Returns the active owner session bearer (memory-only exchange result, or a
 * desktop-supplied session), or undefined when none is live.
 */
export function getOwnerSessionToken(): string | undefined {
	if (isShareMode()) return undefined;
	if (isLive(inMemorySession)) return inMemorySession.token;
	const desktop = desktopSuppliedSession();
	if (isLive(desktop)) return desktop.token;
	return undefined;
}

/** Auth headers for the active owner session, if any. */
export function getOwnerSessionHeaders(): Record<string, string> {
	const token = getOwnerSessionToken();
	return token ? { [OWNER_SESSION_HEADER]: token } : {};
}

/** Clears the memory-only owner session for this tab. */
export function clearOwnerSession(): void {
	inMemorySession = null;
	notifySessionChange();
}

/**
 * Resolves the current owner-auth state.
 * - `share`: booted from a `?share=` link (owner controls hidden).
 * - `owner`: a daemon server token or a live owner session is present.
 * - `unauthenticated`: neither credential is available.
 */
export function getOwnerAuthState(): OwnerAuthState {
	if (isShareMode()) return { status: 'share' };
	if (getRuntimeProjectContext()?.serverToken) return { status: 'owner' };
	if (getOwnerSessionToken()) return { status: 'owner' };
	return { status: 'unauthenticated' };
}

/** True when the current session has full owner access. */
export function isOwnerAuthenticated(): boolean {
	return getOwnerAuthState().status === 'owner';
}

/** Requests a one-time owner authorization challenge from the daemon. */
export async function requestOwnerChallenge(): Promise<{
	challenge: string;
	deviceId: string;
	expiresIn: number;
}> {
	const response = await createTunnelOwnerChallenge({ body: {} });
	if (response.error || !response.data) {
		throw new OwnerAuthError(
			ownerErrorCode(response.error),
			ownerErrorMessage(response.error, 'Failed to create owner challenge'),
			responseStatus(response),
		);
	}
	return {
		challenge: response.data.challenge,
		deviceId: response.data.device_id,
		expiresIn: response.data.expires_in,
	};
}

/**
 * Drives the full owner authorization exchange from a signed assertion:
 * exchanges the assertion for a Secure HttpOnly cookie and records a
 * memory-only bearer for immediate follow-up requests.
 *
 * The assertion must have been minted for a challenge issued by this daemon.
 * Callers that also need the challenge (to request the assertion) should use
 * `requestOwnerChallenge()` first and thread it through their assertion source.
 */
export async function authorizeOwnerWithAssertion(
	assertion: string,
): Promise<OwnerAuthorizationResult> {
	if (isShareMode()) {
		return {
			ok: false,
			reason: 'unavailable',
			message: 'Owner authorization is not available in share mode.',
		};
	}
	if (!assertion) {
		return {
			ok: false,
			reason: 'error',
			code: 'invalid_assertion',
			message: 'A signed owner assertion is required.',
		};
	}

	const response = await createTunnelOwnerSession({ body: { assertion } });
	if (response.error || !response.data) {
		return {
			ok: false,
			reason: 'error',
			code: ownerErrorCode(response.error),
			status: responseStatus(response),
			message: ownerErrorMessage(
				response.error,
				'Owner authorization exchange failed.',
			),
		};
	}

	// The daemon set a Secure HttpOnly cookie; also keep a memory-only bearer so
	// non-browser transports and immediate retries succeed without the cookie.
	const expiresAt = sessionExpiry(response.data.expires_in);
	inMemorySession = { token: response.data.access_token, expiresAt };
	notifySessionChange();
	return { ok: true, expiresAt };
}

/**
 * Owner authorization entry point for the gate. Returns `owner` when a session
 * already exists (local token, live exchange result, or desktop-supplied
 * bearer), otherwise reports `unavailable` because the browser cannot mint a
 * setu assertion on its own. A secure assertion source (desktop shell or a
 * future redirect/connect flow) must call `authorizeOwnerWithAssertion`.
 */
export function beginOwnerAuthorization(): OwnerAuthorizationResult {
	const state = getOwnerAuthState();
	if (state.status === 'owner') {
		return { ok: true, expiresAt: ownerSessionExpiry() };
	}
	if (state.status === 'share') {
		return {
			ok: false,
			reason: 'unavailable',
			message: 'Owner authorization is not available in share mode.',
		};
	}
	return {
		ok: false,
		reason: 'unavailable',
		message:
			'Owner authorization requires signing in through OttoRouter. Open this machine from the otto desktop app to gain owner access.',
	};
}

function ownerSessionExpiry(): number | null {
	if (isLive(inMemorySession)) return inMemorySession.expiresAt;
	const desktop = desktopSuppliedSession();
	if (isLive(desktop)) return desktop.expiresAt;
	return null;
}

export class OwnerAuthError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = 'OwnerAuthError';
	}
}

function responseStatus(response: unknown): number | undefined {
	if (response && typeof response === 'object') {
		const direct = (response as { status?: unknown }).status;
		if (typeof direct === 'number') return direct;
		const nested = (response as { response?: { status?: unknown } }).response
			?.status;
		if (typeof nested === 'number') return nested;
	}
	return undefined;
}

function ownerErrorCode(error: unknown): string {
	if (error && typeof error === 'object' && 'error' in error) {
		const code = (error as { error?: unknown }).error;
		if (typeof code === 'string' && code) return code;
	}
	return 'owner_authorization_failed';
}

function ownerErrorMessage(error: unknown, fallback: string): string {
	if (error && typeof error === 'object') {
		const description = (error as { error_description?: unknown })
			.error_description;
		if (typeof description === 'string' && description) return description;
		const message = (error as { message?: unknown }).message;
		if (typeof message === 'string' && message) return message;
	}
	return fallback;
}
