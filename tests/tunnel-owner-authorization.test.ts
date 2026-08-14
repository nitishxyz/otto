import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAPIHono } from '@hono/zod-openapi';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { registerTunnelRoutes } from '../packages/server/src/routes/tunnel.ts';
import {
	createOwnerChallenge,
	exchangeOwnerAssertion,
	isOwnerSessionAuthorized,
	OWNER_SESSION_COOKIE,
	ownerAuthorizationTesting,
} from '../packages/server/src/routes/tunnel/owner-auth.ts';
import { tunnelAuthMiddleware } from '../packages/server/src/tunnel-auth.ts';

const DEVICE_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_DEVICE_ID = '550e8400-e29b-41d4-a716-446655440001';
const MACHINE_ID = '660e8400-e29b-41d4-a716-446655440000';
const OTHER_MACHINE_ID = '660e8400-e29b-41d4-a716-446655440001';
const nowSeconds = 1_800_000_000;
let now = nowSeconds * 1000;
let server: Server | undefined;
let discoveryUrl = '';
let issuer = '';
let privateKey: CryptoKey;
let publicJwk: JWK;

async function startJwksServer() {
	const keys = await generateKeyPair('EdDSA');
	privateKey = keys.privateKey;
	publicJwk = {
		...(await exportJWK(keys.publicKey)),
		kid: 'owner-key',
		use: 'sig',
	};
	server = createServer((req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/.well-known/oauth-authorization-server') {
			res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/api/auth/jwks` }));
			return;
		}
		if (req.url === '/api/auth/jwks') {
			res.end(JSON.stringify({ keys: [publicJwk] }));
			return;
		}
		res.statusCode = 404;
		res.end();
	});
	await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as AddressInfo).port;
	issuer = `http://127.0.0.1:${port}`;
	discoveryUrl = `${issuer}/.well-known/oauth-authorization-server`;
}

interface AssertionOverrides {
	issuer?: string;
	audience?: string;
	deviceId?: string;
	machineId?: string;
	challenge?: string;
	jti?: string;
	iat?: number;
	nbf?: number;
	exp?: number;
	scope?: string;
	tokenUse?: string;
	sub?: string;
	azp?: string;
	tunnelDeviceId?: string;
	kid?: string;
}

async function assertion(
	challenge: string,
	overrides: AssertionOverrides = {},
): Promise<string> {
	const iat = overrides.iat ?? nowSeconds;
	return new SignJWT({
		scope: overrides.scope ?? 'tunnel:owner',
		token_use: overrides.tokenUse ?? 'tunnel_owner_assertion',
		device_id: overrides.deviceId ?? DEVICE_ID,
		machine_id: overrides.machineId ?? MACHINE_ID,
		tunnel_device_id: overrides.tunnelDeviceId ?? 'setu-device-row',
		org_id: 'org-1',
		challenge: overrides.challenge ?? challenge,
		azp: overrides.azp ?? 'ottocode-cli',
	})
		.setProtectedHeader({ alg: 'EdDSA', kid: overrides.kid ?? 'owner-key' })
		.setIssuer(overrides.issuer ?? `${issuer}/api/auth`)
		.setAudience(
			overrides.audience ?? `urn:otto:daemon:${DEVICE_ID}:${MACHINE_ID}`,
		)
		.setSubject(overrides.sub ?? 'owner-user')
		.setJti(overrides.jti ?? crypto.randomUUID())
		.setIssuedAt(iat)
		.setNotBefore(overrides.nbf ?? iat - 5)
		.setExpirationTime(overrides.exp ?? iat + 60)
		.sign(privateKey);
}

beforeEach(async () => {
	now = nowSeconds * 1000;
	await startJwksServer();
	ownerAuthorizationTesting.reset();
	ownerAuthorizationTesting.setDependencies({
		now: () => now,
		deviceId: async () => DEVICE_ID,
		machineId: async () => MACHINE_ID,
		discoveryUrl: () => discoveryUrl,
		allowInsecureLocalhost: () => true,
	});
});

afterEach(async () => {
	ownerAuthorizationTesting.reset();
	if (server) {
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
	}
});

describe('daemon owner assertion exchange', () => {
	test('verifies Better Auth JWKS and exact claims, then creates a 15-minute session', async () => {
		const created = await createOwnerChallenge('source-1');
		expect(created.device_id).toBe(DEVICE_ID);
		expect(created.machine_id).toBe(MACHINE_ID);
		expect(created.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

		const session = await exchangeOwnerAssertion(
			await assertion(created.challenge),
			'source-1',
		);
		expect(session).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
		expect(session.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(isOwnerSessionAuthorized(session.access_token)).toBe(true);
		now += 900_000;
		expect(isOwnerSessionAuthorized(session.access_token)).toBe(false);
	});

	test('atomically consumes a challenge and rejects concurrent replay', async () => {
		const { challenge } = await createOwnerChallenge('source-2');
		const token = await assertion(challenge);
		const results = await Promise.allSettled([
			exchangeOwnerAssertion(token, 'source-2a'),
			exchangeOwnerAssertion(token, 'source-2b'),
		]);
		expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
			1,
		);
		const rejected = results.find((item) => item.status === 'rejected');
		expect(rejected?.reason).toMatchObject({ status: 409 });
	});

	test('refreshes JWKS immediately for an unknown rotated kid', async () => {
		const initial = await createOwnerChallenge('rotation-initial');
		await exchangeOwnerAssertion(
			await assertion(initial.challenge),
			'rotation-initial',
		);

		const rotated = await generateKeyPair('EdDSA');
		privateKey = rotated.privateKey;
		publicJwk = {
			...(await exportJWK(rotated.publicKey)),
			kid: 'rotated-key',
			use: 'sig',
		};
		const next = await createOwnerChallenge('rotation-next');
		const session = await exchangeOwnerAssertion(
			await assertion(next.challenge, { kid: 'rotated-key' }),
			'rotation-next',
		);
		expect(session.expires_in).toBe(900);
	});

	test('rejects jti replay across separate challenges', async () => {
		const jti = crypto.randomUUID();
		const first = await createOwnerChallenge('source-3a');
		await exchangeOwnerAssertion(
			await assertion(first.challenge, { jti }),
			'source-3a',
		);
		const second = await createOwnerChallenge('source-3b');
		expect(
			exchangeOwnerAssertion(
				await assertion(second.challenge, { jti }),
				'source-3b',
			),
		).rejects.toMatchObject({ status: 409, code: 'assertion_replayed' });
	});

	test('rejects expired challenges without consuming valid assertions', async () => {
		const { challenge } = await createOwnerChallenge('source-4');
		now += 121_000;
		expect(
			exchangeOwnerAssertion(await assertion(challenge), 'source-4'),
		).rejects.toMatchObject({ status: 404, code: 'challenge_not_found' });
	});

	for (const [name, overrides] of [
		['issuer', { issuer: 'https://attacker.example/api/auth' }],
		['audience', { audience: `urn:otto:daemon:${OTHER_DEVICE_ID}` }],
		['device', { deviceId: OTHER_DEVICE_ID }],
		['machine', { machineId: OTHER_MACHINE_ID }],
		['challenge', { challenge: 'A'.repeat(43) }],
		['scope', { scope: 'inference' }],
		['purpose', { tokenUse: 'access_token' }],
		['ttl', { exp: nowSeconds + 61 }],
		['skew', { nbf: nowSeconds - 4 }],
		['subject', { sub: '' }],
		['authorized party', { azp: '' }],
		['tunnel row', { tunnelDeviceId: '' }],
	] as const) {
		test(`rejects ${name} mismatch without consuming the challenge`, async () => {
			const { challenge } = await createOwnerChallenge(`claim-${name}`);
			const expectedError =
				name === 'challenge'
					? { status: 404, code: 'challenge_not_found' }
					: { status: 401, code: 'invalid_assertion' };
			expect(
				exchangeOwnerAssertion(
					await assertion(challenge, overrides),
					`claim-${name}`,
				),
			).rejects.toMatchObject(expectedError);

			const valid = await exchangeOwnerAssertion(
				await assertion(challenge),
				`claim-${name}-valid`,
			);
			expect(valid.expires_in).toBe(900);
		});
	}

	test('enforces challenge creation and exchange attempt limits', async () => {
		for (let index = 0; index < 10; index += 1) {
			await createOwnerChallenge('rate-source');
		}
		expect(createOwnerChallenge('rate-source')).rejects.toMatchObject({
			status: 429,
			code: 'rate_limited',
		});

		const { challenge } = await createOwnerChallenge('attempt-source');
		for (let index = 0; index < 5; index += 1) {
			expect(
				exchangeOwnerAssertion('bad.jwt.value', `bad-${index}`),
			).rejects.toMatchObject({ status: 401 });
		}
		for (let index = 0; index < 5; index += 1) {
			expect(
				exchangeOwnerAssertion(
					await assertion(challenge, { scope: 'invalid' }),
					`attempt-${index}`,
				),
			).rejects.toMatchObject({ status: 401 });
		}
		expect(
			exchangeOwnerAssertion(
				await assertion(challenge, { scope: 'invalid' }),
				'attempt-final',
			),
		).rejects.toMatchObject({ status: 429 });
	});
});

describe('owner authorization routes and middleware', () => {
	test('public handshake sets a secure cookie accepted as full owner auth', async () => {
		const app = new OpenAPIHono();
		app.use('*', tunnelAuthMiddleware);
		registerTunnelRoutes(app);
		app.get('/v1/owner-only', (c) => c.json({ ok: true }));
		app.get('/v1/attachments/att-owner', (c) => c.body('image'));

		const challengeResponse = await app.request(
			'https://device.ottorouter.org/v1/tunnel/owner/challenge',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
			},
		);
		expect(challengeResponse.status).toBe(200);
		const challengeBody = (await challengeResponse.json()) as {
			challenge: string;
		};

		const sessionResponse = await app.request(
			'https://device.ottorouter.org/v1/tunnel/owner/session',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					assertion: await assertion(challengeBody.challenge),
				}),
			},
		);
		expect(sessionResponse.status).toBe(200);
		expect(sessionResponse.headers.get('cache-control')).toBe('no-store');
		const cookie = sessionResponse.headers.get('set-cookie') ?? '';
		const sessionBody = (await sessionResponse.json()) as {
			access_token: string;
		};
		expect(cookie).toContain(`${OWNER_SESSION_COOKIE}=`);
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('Secure');
		expect(cookie).toContain('SameSite=Strict');

		const authorized = await app.request(
			'https://device.ottorouter.org/v1/owner-only',
			{ headers: { Cookie: cookie.split(';')[0] ?? '' } },
		);
		expect(authorized.status).toBe(200);
		const headerAuthorized = await app.request(
			'https://device.ottorouter.org/v1/owner-only',
			{ headers: { 'X-Otto-Owner-Session': sessionBody.access_token } },
		);
		expect(headerAuthorized.status).toBe(200);
		const ownerHeaderAttachment = await app.request(
			'https://device.ottorouter.org/v1/attachments/att-owner',
			{ headers: { 'X-Otto-Owner-Session': sessionBody.access_token } },
		);
		expect(ownerHeaderAttachment.status).toBe(200);
		const ownerCookieAttachment = await app.request(
			'https://device.ottorouter.org/v1/attachments/att-owner',
			{ headers: { Cookie: cookie.split(';')[0] ?? '' } },
		);
		expect(ownerCookieAttachment.status).toBe(200);
		const bearerAuthorized = await app.request(
			'https://device.ottorouter.org/v1/owner-only',
			{ headers: { Authorization: `Bearer ${sessionBody.access_token}` } },
		);
		expect(bearerAuthorized.status).toBe(200);
	});
});
