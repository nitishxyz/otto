import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from 'bun:test';
import type { OAuth } from '../packages/sdk/src/types/src/index.ts';
import * as authActual from '../packages/sdk/src/auth/src/index.ts';

const realAuth = { ...authActual };

const EXPIRED_OAUTH: OAuth = {
	type: 'oauth',
	access: 'expired-access',
	refresh: 'refresh-token',
	expires: Date.now() - 60_000,
};

const getAuthMock = mock(async () => EXPIRED_OAUTH);
const setAuthMock = mock(async () => {});

mock.module('../packages/sdk/src/auth/src/index.ts', () => ({
	...realAuth,
	getAuth: getAuthMock,
	setAuth: setAuthMock,
}));

afterAll(() => {
	mock.module('../packages/sdk/src/auth/src/index.ts', () => realAuth);
});

const { createAnthropicOAuthFetch } = await import(
	'../packages/sdk/src/providers/src/anthropic-oauth-client.ts'
);

describe('anthropic oauth client', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		getAuthMock.mockClear();
		setAuthMock.mockClear();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('deduplicates concurrent refresh calls for expired OAuth tokens', async () => {
		let refreshCalls = 0;
		const authorizationHeaders: string[] = [];

		globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
			const target = String(url);
			if (target.includes('/v1/oauth/token')) {
				refreshCalls += 1;
				await new Promise((resolve) => setTimeout(resolve, 25));
				return new Response(
					JSON.stringify({
						access_token: 'fresh-access',
						refresh_token: 'fresh-refresh',
						expires_in: 3600,
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				);
			}

			const headers = new Headers(init?.headers);
			authorizationHeaders.push(headers.get('authorization') ?? '');
			return new Response('ok', { status: 200 });
		}) as typeof fetch;

		const customFetch = createAnthropicOAuthFetch({
			oauth: {
				access: EXPIRED_OAUTH.access,
				refresh: EXPIRED_OAUTH.refresh,
				expires: EXPIRED_OAUTH.expires,
			},
			projectRoot: '/tmp/anthropic-oauth-test',
		});

		const [first, second] = await Promise.all([
			customFetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				body: JSON.stringify({ model: 'claude', messages: [] }),
			}),
			customFetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				body: JSON.stringify({ model: 'claude', messages: [] }),
			}),
		]);

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(refreshCalls).toBe(1);
		expect(authorizationHeaders).toEqual([
			'Bearer fresh-access',
			'Bearer fresh-access',
		]);
		expect(setAuthMock).toHaveBeenCalled();
	});
});
