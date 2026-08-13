import { afterEach, describe, expect, test } from 'bun:test';
import { authorizeXaiDevice } from '../packages/sdk/src/auth/src/xai-oauth.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('xAI device OAuth', () => {
	test('requests Grok Build scopes and polls the RFC 8628 token endpoint', async () => {
		const requests: Request[] = [];
		globalThis.fetch = async (input, init) => {
			const request = new Request(input, init);
			requests.push(request);
			if (request.url.endsWith('/oauth2/device/code')) {
				return Response.json({
					device_code: 'device-secret',
					user_code: 'ABCD-EFGH',
					verification_uri: 'https://accounts.x.ai/device',
					verification_uri_complete:
						'https://accounts.x.ai/device?user_code=ABCD-EFGH',
					expires_in: 60,
					interval: 0,
				});
			}
			return Response.json({
				access_token: 'access-token',
				refresh_token: 'refresh-token',
				expires_in: 3600,
				scope: 'grok-cli:access conversations:read workspaces:read',
			});
		};

		const authorization = await authorizeXaiDevice();
		expect(authorization).toMatchObject({
			verificationUri: 'https://accounts.x.ai/device',
			verificationUriComplete:
				'https://accounts.x.ai/device?user_code=ABCD-EFGH',
			userCode: 'ABCD-EFGH',
		});
		const tokens = await authorization.waitForTokens();
		expect(tokens).toMatchObject({
			access: 'access-token',
			refresh: 'refresh-token',
		});

		const deviceBody = await requests[0].formData();
		expect(String(deviceBody.get('scope'))).toContain('conversations:write');
		expect(String(deviceBody.get('scope'))).toContain('workspaces:write');
		expect(deviceBody.get('referrer')).toBe('grok-build');
		expect(requests[0].headers.get('x-grok-client-surface')).toBe('ui');
		const tokenBody = await requests[1].formData();
		expect(tokenBody.get('grant_type')).toBe(
			'urn:ietf:params:oauth:grant-type:device_code',
		);
		expect(tokenBody.get('device_code')).toBe('device-secret');
	});

	test('rejects verification URLs outside x.ai', async () => {
		globalThis.fetch = async () =>
			Response.json({
				device_code: 'device-secret',
				user_code: 'ABCD-EFGH',
				verification_uri: 'https://example.com/device',
			});

		expect(authorizeXaiDevice()).rejects.toThrow(
			'xAI device authorization returned unexpected verification URL',
		);
	});

	test('builds a complete verification URL when xAI omits one', async () => {
		globalThis.fetch = async () =>
			Response.json({
				device_code: 'device-secret',
				user_code: 'ABCD-EFGH',
				verification_uri: 'https://accounts.x.ai/device',
			});

		const authorization = await authorizeXaiDevice();
		expect(authorization.verificationUriComplete).toBe(
			'https://accounts.x.ai/device?user_code=ABCD-EFGH',
		);
	});
});
