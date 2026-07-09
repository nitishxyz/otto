/**
 * Debug harness for the OttoRouter OAuth device flow.
 *
 * Runs the exact SDK code path otto uses, then probes the issued token:
 *   1. Request device code (prints verification URL for manual approval)
 *   2. Poll for tokens, timing each poll and logging raw poll outcomes
 *   3. Decode the access token JWT (iss/aud/sub/scope/exp)
 *   4. GET  /api/auth/oauth2/userinfo
 *   5. GET  /v1/balance
 *   6. POST /v1/chat/completions (tiny request)
 *   7. Refresh-token grant round trip
 *
 * Usage: bun run scripts/debug-ottorouter-oauth.ts
 */
import {
	pollOttoRouterDeviceCodeOnce,
	requestOttoRouterDeviceCode,
} from '../packages/sdk/src/auth/src/ottorouter-oauth.ts';
import { refreshOttoRouterToken } from '../packages/sdk/src/auth/src/ottorouter-oauth.ts';

const BASE_URL = (
	process.env.OTTOROUTER_BASE_URL ?? 'https://api.ottorouter.org'
).replace(/\/$/, '');

function log(label: string, value?: unknown) {
	const ts = new Date().toISOString().slice(11, 23);
	if (value === undefined) {
		console.log(`[${ts}] ${label}`);
	} else {
		console.log(
			`[${ts}] ${label}:`,
			typeof value === 'string' ? value : JSON.stringify(value, null, 2),
		);
	}
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split('.');
	if (parts.length !== 3 || !parts[1]) return null;
	try {
		const body = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		return JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
	} catch {
		return null;
	}
}

async function probe(
	label: string,
	url: string,
	init: RequestInit,
): Promise<void> {
	const started = Date.now();
	try {
		const res = await fetch(url, init);
		const text = await res.text();
		let body: unknown = text;
		try {
			body = JSON.parse(text);
		} catch {}
		log(
			`${label} -> HTTP ${res.status} (${Date.now() - started}ms)`,
			body,
		);
		if (res.status === 401) {
			log(`${label} WWW-Authenticate`, res.headers.get('www-authenticate'));
		}
	} catch (err) {
		log(`${label} FAILED`, err instanceof Error ? err.message : String(err));
	}
}

async function main() {
	log('Base URL', BASE_URL);

	// 1. Device code
	const started = Date.now();
	const device = await requestOttoRouterDeviceCode();
	log(`device/code ok (${Date.now() - started}ms)`, {
		userCode: device.userCode,
		verificationUri: device.verificationUri,
		verificationUriComplete: device.verificationUriComplete,
		interval: device.interval,
		expiresIn: device.expiresIn,
	});

	console.log('\n==============================================');
	console.log('  APPROVE NOW:');
	console.log(`  ${device.verificationUriComplete ?? device.verificationUri}`);
	console.log(`  Code: ${device.userCode}`);
	console.log('==============================================\n');

	// 2. Poll
	const intervalMs = Math.max(device.interval, 1) * 1000;
	const deadline = Date.now() + (device.expiresIn ?? 900) * 1000;
	let tokens: Awaited<
		ReturnType<typeof pollOttoRouterDeviceCodeOnce>
	> | null = null;
	let pollCount = 0;
	while (Date.now() < deadline) {
		pollCount += 1;
		const pollStart = Date.now();
		const result = await pollOttoRouterDeviceCodeOnce(device.deviceCode);
		const elapsed = Date.now() - pollStart;
		if (result.status === 'pending') {
			log(`poll #${pollCount} -> pending (${elapsed}ms)`);
		} else if (result.status === 'error') {
			log(`poll #${pollCount} -> ERROR (${elapsed}ms)`, result.error);
			process.exit(1);
		} else {
			log(`poll #${pollCount} -> COMPLETE (${elapsed}ms)`);
			tokens = result;
			break;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	if (!tokens || tokens.status !== 'complete') {
		log('Timed out waiting for approval');
		process.exit(1);
	}

	const { access, refresh, expires, scopes } = tokens.tokens;
	log('tokens', {
		accessPrefix: `${access.slice(0, 24)}...`,
		accessLength: access.length,
		refreshPrefix: `${refresh.slice(0, 12)}...`,
		refreshLength: refresh.length,
		expires: new Date(expires).toISOString(),
		scopes: scopes ?? '(none returned)',
	});

	// 3. Decode JWT
	const payload = decodeJwtPayload(access);
	log('access_token JWT payload', payload ?? 'NOT A JWT / decode failed');

	const bearer = { Authorization: `Bearer ${access}` };

	// 4-6. Probes
	await probe('GET /api/auth/oauth2/userinfo', `${BASE_URL}/api/auth/oauth2/userinfo`, {
		headers: bearer,
	});
	await probe('GET /v1/balance', `${BASE_URL}/v1/balance`, { headers: bearer });
	await probe('GET /v1/account', `${BASE_URL}/v1/account`, { headers: bearer });
	await probe('POST /v1/chat/completions', `${BASE_URL}/v1/chat/completions`, {
		method: 'POST',
		headers: { ...bearer, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'claude-3-5-haiku-latest',
			max_tokens: 16,
			messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
		}),
	});

	// 7. Refresh grant
	try {
		const refreshStart = Date.now();
		const refreshed = await refreshOttoRouterToken(refresh);
		log(`refresh ok (${Date.now() - refreshStart}ms)`, {
			accessPrefix: `${refreshed.access.slice(0, 24)}...`,
			refreshRotated: refreshed.refresh !== refresh,
			scopes: refreshed.scopes ?? '(none returned)',
		});
		const refreshedPayload = decodeJwtPayload(refreshed.access);
		log('refreshed JWT payload', refreshedPayload ?? 'decode failed');
		await probe(
			'GET /v1/balance (refreshed token)',
			`${BASE_URL}/v1/balance`,
			{ headers: { Authorization: `Bearer ${refreshed.access}` } },
		);
	} catch (err) {
		log('refresh FAILED', err instanceof Error ? err.message : String(err));
	}

	log('done');
}

main().catch((err) => {
	log('FATAL', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
