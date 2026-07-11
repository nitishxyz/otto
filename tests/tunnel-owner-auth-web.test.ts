import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as ownerAuth from '../packages/web-sdk/src/lib/owner-auth.ts';
import * as utils from '../packages/web-sdk/src/lib/api-client/utils.ts';

// Owner-auth browser flow tests. The web-sdk API client is Axios-based with the
// fetch adapter, so we drive it by mocking globalThis.fetch and inspecting the
// requests the owner-auth exchange makes.

interface FetchCall {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

const calls: FetchCall[] = [];
let responder: (call: FetchCall) => Response;
const originalFetch = globalThis.fetch;

function installWindow(runtimeContext?: unknown) {
	(globalThis as unknown as { window: unknown }).window = {
		location: { href: 'https://device.example/', search: '' },
		fetch: globalThis.fetch,
		localStorage: {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {},
		},
		sessionStorage: {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {},
		},
		OTTO_SERVER_URL: 'https://device.example',
		OTTO_RUNTIME_CONTEXT: runtimeContext,
	};
	// Re-read adapter/baseURL/auth headers now that the mocked window exists.
	utils.configureApiClient();
}

function jsonResponse(status: number, data: unknown): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

beforeEach(() => {
	calls.length = 0;
	ownerAuth.clearOwnerSession();
	responder = () => jsonResponse(404, { error: 'not_mocked' });
	globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
		const request =
			input && typeof input === 'object' && 'url' in (input as object)
				? (input as Request)
				: undefined;
		const url = String(
			request?.url ??
				(typeof input === 'string' || input instanceof URL ? input : ''),
		);
		const headers: Record<string, string> = {};
		new Headers(init?.headers ?? request?.headers).forEach((value, key) => {
			headers[key] = value;
		});
		let body: unknown;
		const rawBody = init?.body ?? undefined;
		if (typeof rawBody === 'string') {
			try {
				body = JSON.parse(rawBody);
			} catch {
				body = rawBody;
			}
		} else if (request?.body) {
			try {
				body = await request.clone().json();
			} catch {
				body = undefined;
			}
		}
		const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
		const call: FetchCall = { url, method, headers, body };
		calls.push(call);
		return responder(call);
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	delete (globalThis as unknown as { window?: unknown }).window;
});

describe('owner-auth browser exchange', () => {
	it('requests a challenge from the same-origin daemon', async () => {
		installWindow();
		responder = (call) => {
			if (call.url.endsWith('/v1/tunnel/owner/challenge')) {
				return jsonResponse(200, {
					challenge: 'challenge-token',
					device_id: '550e8400-e29b-41d4-a716-446655440000',
					expires_in: 120,
				});
			}
			return jsonResponse(404, { error: 'not_mocked' });
		};

		const result = await ownerAuth.requestOwnerChallenge();

		expect(result).toEqual({
			challenge: 'challenge-token',
			deviceId: '550e8400-e29b-41d4-a716-446655440000',
			expiresIn: 120,
		});
		const challengeCall = calls.find((c) =>
			c.url.endsWith('/v1/tunnel/owner/challenge'),
		);
		expect(challengeCall?.method).toBe('POST');
	});

	it('exchanges an assertion for an owner session and attaches the bearer', async () => {
		installWindow();
		responder = (call) => {
			if (call.url.endsWith('/v1/tunnel/owner/session')) {
				return new Response(
					JSON.stringify({
						access_token: 'owner-session-token',
						token_type: 'Bearer',
						expires_in: 900,
					}),
					{
						status: 200,
						headers: {
							'content-type': 'application/json',
							'set-cookie':
								'otto_owner_session=owner-session-token; Path=/; HttpOnly; Secure; SameSite=Strict',
						},
					},
				);
			}
			return jsonResponse(404, { error: 'not_mocked' });
		};

		const before = Date.now();
		const result = await ownerAuth.authorizeOwnerWithAssertion('signed.jwt');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.expiresAt).not.toBeNull();
			expect(result.expiresAt as number).toBeGreaterThanOrEqual(
				before + 900_000,
			);
		}

		const sessionCall = calls.find((c) =>
			c.url.endsWith('/v1/tunnel/owner/session'),
		);
		expect(sessionCall?.method).toBe('POST');
		expect(sessionCall?.body).toEqual({ assertion: 'signed.jwt' });

		// The exchanged bearer is now attached to subsequent API auth headers.
		expect(ownerAuth.getOwnerSessionToken()).toBe('owner-session-token');
		expect(ownerAuth.getOwnerSessionHeaders()).toEqual({
			'X-Otto-Owner-Session': 'owner-session-token',
		});
		expect(utils.getAuthHeaders()).toMatchObject({
			'X-Otto-Owner-Session': 'owner-session-token',
		});
		expect(ownerAuth.getOwnerAuthState()).toEqual({ status: 'owner' });
	});

	it('returns a typed error result when the exchange is rejected', async () => {
		installWindow();
		responder = (call) => {
			if (call.url.endsWith('/v1/tunnel/owner/session')) {
				return jsonResponse(401, {
					error: 'invalid_assertion',
					error_description: 'Owner assertion validation failed',
				});
			}
			return jsonResponse(404, { error: 'not_mocked' });
		};

		const result = await ownerAuth.authorizeOwnerWithAssertion('bad.jwt');

		expect(result.ok).toBe(false);
		if (!result.ok && result.reason === 'error') {
			expect(result.code).toBe('invalid_assertion');
			expect(result.status).toBe(401);
			expect(result.message).toBe('Owner assertion validation failed');
		} else {
			throw new Error('expected a typed error result');
		}
		// A rejected exchange leaves no owner session.
		expect(ownerAuth.getOwnerSessionToken()).toBeUndefined();
		expect(ownerAuth.getOwnerAuthState()).toEqual({
			status: 'unauthenticated',
		});
	});

	it('reports unavailable when no assertion source or session exists', async () => {
		installWindow();
		const result = ownerAuth.beginOwnerAuthorization();
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('unavailable');
		}
		expect(ownerAuth.isOwnerAuthenticated()).toBe(false);
	});

	it('accepts a desktop-supplied memory-only owner session', async () => {
		installWindow({
			ownerSession: {
				token: 'desktop-owner-token',
				expiresAt: Date.now() + 900_000,
			},
		});

		expect(ownerAuth.getOwnerAuthState()).toEqual({ status: 'owner' });
		expect(ownerAuth.beginOwnerAuthorization().ok).toBe(true);
		expect(utils.getAuthHeaders()).toMatchObject({
			'X-Otto-Owner-Session': 'desktop-owner-token',
		});
	});

	it('ignores an expired desktop-supplied owner session', async () => {
		installWindow({
			ownerSession: {
				token: 'stale-owner-token',
				expiresAt: Date.now() - 1000,
			},
		});
		expect(ownerAuth.getOwnerSessionToken()).toBeUndefined();
		expect(ownerAuth.getOwnerAuthState()).toEqual({
			status: 'unauthenticated',
		});
	});
});
