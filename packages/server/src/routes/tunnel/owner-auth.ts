import { createHash, randomBytes } from 'node:crypto';
import {
	createRemoteJWKSet,
	customFetch,
	decodeJwt,
	jwtVerify,
	type JWTPayload,
} from 'jose';
import {
	getManagedTunnelDeviceId,
	isManagedTunnelDeviceId,
} from '@ottocode/sdk';

export const OWNER_SESSION_COOKIE = 'otto_owner_session';
export const OWNER_SESSION_HEADER = 'x-otto-owner-session';

const CHALLENGE_TTL_SECONDS = 120;
const SESSION_TTL_SECONDS = 900;
const ASSERTION_TTL_SECONDS = 60;
const CLOCK_TOLERANCE_SECONDS = 5;
const MAX_CHALLENGES = 32;
const MAX_CREATIONS_PER_MINUTE = 10;
const MAX_EXCHANGES_PER_MINUTE = 10;
const MAX_ATTEMPTS_PER_CHALLENGE = 5;
const JWKS_CACHE_MS = 10 * 60 * 1000;

type ChallengeState = 'active' | 'consumed';

interface ChallengeRecord {
	expiresAt: number;
	state: ChallengeState;
	attempts: number;
}

interface OwnerSessionRecord {
	sub: string;
	deviceId: string;
	jti: string;
	createdAt: number;
	expiresAt: number;
}

interface RateRecord {
	startedAt: number;
	count: number;
}

interface DiscoveryDocument {
	issuer?: unknown;
	jwks_uri?: unknown;
}

export interface OwnerAssertionDependencies {
	now: () => number;
	fetch: typeof globalThis.fetch;
	deviceId: () => Promise<string>;
	discoveryUrl: () => string;
	allowInsecureLocalhost: () => boolean;
	verifyAssertion?: (
		assertion: string,
		expected: { issuer: string; audience: string },
	) => Promise<JWTPayload>;
}

export class OwnerAuthorizationError extends Error {
	constructor(
		public readonly status: 400 | 401 | 404 | 409 | 429,
		public readonly code: string,
		message: string,
		public readonly retryAfter?: number,
	) {
		super(message);
	}
}

const challenges = new Map<string, ChallengeRecord>();
const ownerSessions = new Map<string, OwnerSessionRecord>();
const replayedJtis = new Map<string, number>();
const creationRates = new Map<string, RateRecord>();
const exchangeRates = new Map<string, RateRecord>();

const defaultDependencies: OwnerAssertionDependencies = {
	now: () => Date.now(),
	fetch: globalThis.fetch,
	deviceId: () => getManagedTunnelDeviceId(),
	discoveryUrl: () =>
		process.env.OTTOROUTER_OAUTH_DISCOVERY_URL ??
		`${(process.env.OTTOROUTER_BASE_URL ?? 'https://api.ottorouter.org').replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
	allowInsecureLocalhost: () =>
		process.env.OTTOROUTER_ALLOW_INSECURE_LOCALHOST === '1',
};

let dependencies: OwnerAssertionDependencies = { ...defaultDependencies };
let cachedDiscovery:
	| {
			issuer: string;
			jwksUri: string;
			jwks: ReturnType<typeof createRemoteJWKSet>;
			expiresAt: number;
	  }
	| undefined;

function digest(value: string): string {
	return createHash('sha256').update(value).digest('base64url');
}

function opaqueToken(): string {
	return randomBytes(32).toString('base64url');
}

function cleanExpired(now: number): void {
	for (const [hash, record] of challenges) {
		if (record.expiresAt <= now) challenges.delete(hash);
	}
	for (const [hash, record] of ownerSessions) {
		if (record.expiresAt <= now) ownerSessions.delete(hash);
	}
	for (const [jti, expiresAt] of replayedJtis) {
		if (expiresAt <= now) replayedJtis.delete(jti);
	}
	for (const rates of [creationRates, exchangeRates]) {
		for (const [source, record] of rates) {
			if (record.startedAt + 60_000 <= now) rates.delete(source);
		}
	}
}

function checkRate(
	rates: Map<string, RateRecord>,
	source: string,
	limit: number,
	now: number,
): void {
	const current = rates.get(source);
	if (!current || current.startedAt + 60_000 <= now) {
		rates.set(source, { startedAt: now, count: 1 });
		return;
	}
	if (current.count >= limit) {
		throw new OwnerAuthorizationError(
			429,
			'rate_limited',
			'Owner authorization rate limit exceeded',
			Math.max(1, Math.ceil((current.startedAt + 60_000 - now) / 1000)),
		);
	}
	current.count += 1;
}

function validateHttpsEndpoint(value: string, allowLocalhost: boolean): URL {
	const url = new URL(value);
	const localhost =
		url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(allowLocalhost && localhost)) {
		throw new Error('OttoRouter authorization metadata must use HTTPS');
	}
	return url;
}

function canonicalIssuer(value: string): string {
	const normalized = value.replace(/\/$/, '');
	return normalized.endsWith('/api/auth')
		? normalized
		: `${normalized}/api/auth`;
}

async function getVerificationMetadata() {
	const now = dependencies.now();
	if (cachedDiscovery && cachedDiscovery.expiresAt > now)
		return cachedDiscovery;

	const discoveryUrl = validateHttpsEndpoint(
		dependencies.discoveryUrl(),
		dependencies.allowInsecureLocalhost(),
	);
	const response = await dependencies.fetch(discoveryUrl, {
		headers: { Accept: 'application/json' },
	});
	if (!response.ok)
		throw new Error('OttoRouter authorization discovery failed');
	const document = (await response.json()) as DiscoveryDocument;
	if (
		typeof document.issuer !== 'string' ||
		typeof document.jwks_uri !== 'string'
	) {
		throw new Error('OttoRouter authorization metadata is invalid');
	}
	const issuerUrl = validateHttpsEndpoint(
		document.issuer,
		dependencies.allowInsecureLocalhost(),
	);
	const jwksUrl = validateHttpsEndpoint(
		document.jwks_uri,
		dependencies.allowInsecureLocalhost(),
	);
	if (
		issuerUrl.origin !== discoveryUrl.origin ||
		jwksUrl.origin !== discoveryUrl.origin
	) {
		throw new Error('OttoRouter authorization metadata origin mismatch');
	}

	cachedDiscovery = {
		issuer: canonicalIssuer(issuerUrl.toString()),
		jwksUri: jwksUrl.toString(),
		jwks: createRemoteJWKSet(jwksUrl, {
			cacheMaxAge: JWKS_CACHE_MS,
			cooldownDuration: 0,
			[customFetch]: dependencies.fetch,
		}),
		expiresAt: now + JWKS_CACHE_MS,
	};
	return cachedDiscovery;
}

async function verifyJwt(
	assertion: string,
	expected: { issuer: string; audience: string },
): Promise<JWTPayload> {
	if (dependencies.verifyAssertion) {
		return dependencies.verifyAssertion(assertion, expected);
	}
	const metadata = await getVerificationMetadata();
	const { payload } = await jwtVerify(assertion, metadata.jwks, {
		algorithms: ['EdDSA'],
		issuer: expected.issuer,
		audience: expected.audience,
		clockTolerance: CLOCK_TOLERANCE_SECONDS,
		currentDate: new Date(dependencies.now()),
	});
	return payload;
}

function assertionChallenge(assertion: string): string | undefined {
	try {
		const challenge = decodeJwt(assertion).challenge;
		return typeof challenge === 'string' ? challenge : undefined;
	} catch {
		return undefined;
	}
}

/** Creates a bounded, one-time owner authorization challenge. */
export async function createOwnerChallenge(source: string) {
	const now = dependencies.now();
	cleanExpired(now);
	checkRate(creationRates, source, MAX_CREATIONS_PER_MINUTE, now);
	if (challenges.size >= MAX_CHALLENGES) {
		throw new OwnerAuthorizationError(
			429,
			'rate_limited',
			'Too many active owner authorization challenges',
			1,
		);
	}

	const deviceId = await dependencies.deviceId();
	if (!isManagedTunnelDeviceId(deviceId)) {
		throw new Error('Local tunnel device identity is invalid');
	}
	const challenge = opaqueToken();
	challenges.set(digest(challenge), {
		expiresAt: now + CHALLENGE_TTL_SECONDS * 1000,
		state: 'active',
		attempts: 0,
	});
	return {
		challenge,
		device_id: deviceId,
		expires_in: CHALLENGE_TTL_SECONDS as 120,
	};
}

function validateClaims(
	payload: JWTPayload,
	expected: {
		issuer: string;
		audience: string;
		deviceId: string;
		challenge: string;
	},
	nowSeconds: number,
): asserts payload is JWTPayload & {
	sub: string;
	jti: string;
	iat: number;
	nbf: number;
	exp: number;
} {
	const iat = payload.iat;
	const nbf = payload.nbf;
	const exp = payload.exp;
	if (
		payload.iss !== expected.issuer ||
		payload.aud !== expected.audience ||
		payload.token_use !== 'tunnel_owner_assertion' ||
		payload.scope !== 'tunnel:owner' ||
		payload.device_id !== expected.deviceId ||
		payload.challenge !== expected.challenge ||
		typeof payload.sub !== 'string' ||
		!payload.sub ||
		typeof payload.azp !== 'string' ||
		!payload.azp ||
		typeof payload.tunnel_device_id !== 'string' ||
		!payload.tunnel_device_id ||
		typeof payload.org_id !== 'string' ||
		!payload.org_id ||
		typeof payload.jti !== 'string' ||
		!payload.jti ||
		!Number.isInteger(iat) ||
		!Number.isInteger(nbf) ||
		!Number.isInteger(exp) ||
		typeof iat !== 'number' ||
		typeof nbf !== 'number' ||
		typeof exp !== 'number' ||
		exp - iat !== ASSERTION_TTL_SECONDS ||
		nbf !== iat - CLOCK_TOLERANCE_SECONDS ||
		iat > nowSeconds + CLOCK_TOLERANCE_SECONDS ||
		exp <= nowSeconds - CLOCK_TOLERANCE_SECONDS
	) {
		throw new OwnerAuthorizationError(
			401,
			'invalid_assertion',
			'Owner assertion validation failed',
		);
	}
}

/** Verifies an owner assertion, consumes its challenge, and issues a session. */
export async function exchangeOwnerAssertion(
	assertion: string,
	source: string,
) {
	const now = dependencies.now();
	cleanExpired(now);
	checkRate(exchangeRates, source, MAX_EXCHANGES_PER_MINUTE, now);

	const unverifiedChallenge = assertionChallenge(assertion);
	if (!unverifiedChallenge) {
		throw new OwnerAuthorizationError(
			401,
			'invalid_assertion',
			'Owner assertion validation failed',
		);
	}
	const challengeHash = unverifiedChallenge
		? digest(unverifiedChallenge)
		: undefined;
	const challenge = challengeHash ? challenges.get(challengeHash) : undefined;
	if (challenge) {
		if (challenge.state === 'consumed') {
			throw new OwnerAuthorizationError(
				409,
				'challenge_consumed',
				'Owner authorization challenge was already consumed',
			);
		}
		challenge.attempts += 1;
		if (challenge.attempts > MAX_ATTEMPTS_PER_CHALLENGE) {
			throw new OwnerAuthorizationError(
				429,
				'rate_limited',
				'Owner authorization challenge attempt limit exceeded',
				1,
			);
		}
	}

	if (!challenge || challenge.expiresAt <= now) {
		throw new OwnerAuthorizationError(
			404,
			'challenge_not_found',
			'Owner authorization challenge is unknown or expired',
		);
	}

	const deviceId = await dependencies.deviceId();
	if (!isManagedTunnelDeviceId(deviceId)) {
		throw new OwnerAuthorizationError(
			401,
			'invalid_assertion',
			'Local tunnel device identity is invalid',
		);
	}
	const metadata = dependencies.verifyAssertion
		? {
				issuer: canonicalIssuer(
					process.env.BETTER_AUTH_URL ?? 'https://api.ottorouter.org',
				),
			}
		: await getVerificationMetadata();
	const expected = {
		issuer: metadata.issuer,
		audience: `urn:otto:daemon:${deviceId}`,
		deviceId,
		challenge: unverifiedChallenge,
	};

	let payload: JWTPayload;
	try {
		payload = await verifyJwt(assertion, expected);
	} catch (error) {
		if (error instanceof OwnerAuthorizationError) throw error;
		throw new OwnerAuthorizationError(
			401,
			'invalid_assertion',
			'Owner assertion validation failed',
		);
	}
	validateClaims(payload, expected, Math.floor(now / 1000));

	if (replayedJtis.has(payload.jti)) {
		throw new OwnerAuthorizationError(
			409,
			'assertion_replayed',
			'Owner assertion was already exchanged',
		);
	}
	if (challenge.state !== 'active') {
		throw new OwnerAuthorizationError(
			409,
			'challenge_consumed',
			'Owner authorization challenge was already consumed',
		);
	}

	challenge.state = 'consumed';
	replayedJtis.set(
		payload.jti,
		Math.max(challenge.expiresAt, payload.exp * 1000),
	);
	const accessToken = opaqueToken();
	ownerSessions.set(digest(accessToken), {
		sub: payload.sub,
		deviceId,
		jti: payload.jti,
		createdAt: now,
		expiresAt: now + SESSION_TTL_SECONDS * 1000,
	});
	return {
		access_token: accessToken,
		token_type: 'Bearer' as const,
		expires_in: SESSION_TTL_SECONDS as 900,
	};
}

/** Checks a memory-only owner session token and removes it after expiry. */
export function isOwnerSessionAuthorized(token: string | undefined): boolean {
	if (!token) return false;
	const now = dependencies.now();
	cleanExpired(now);
	return ownerSessions.has(digest(token));
}

/** Drops all owner authorization state, such as during daemon shutdown. */
export function clearOwnerAuthorizationState(): void {
	challenges.clear();
	ownerSessions.clear();
	replayedJtis.clear();
	creationRates.clear();
	exchangeRates.clear();
	cachedDiscovery = undefined;
}

export const ownerAuthorizationTesting = {
	setDependencies(overrides: Partial<OwnerAssertionDependencies>) {
		dependencies = { ...dependencies, ...overrides };
		cachedDiscovery = undefined;
	},
	reset() {
		clearOwnerAuthorizationState();
		dependencies = { ...defaultDependencies };
	},
	counts() {
		return {
			challenges: challenges.size,
			sessions: ownerSessions.size,
			jtis: replayedJtis.size,
		};
	},
};
