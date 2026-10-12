import { expect, test } from 'bun:test';
import { CACHE_USAGE_NORMALIZATION_MARKER as databaseMarker } from '@ottocode/database/markers';
import { CACHE_USAGE_NORMALIZATION_MARKER as sdkMarker } from '@ottocode/sdk/providers';

test('SDK cache usage marker re-exports the authoritative database identity', () => {
	expect(sdkMarker).toBe(databaseMarker);
	expect(sdkMarker).toBe('cache_usage_normalization_v2_enabled');
});

test('server preserves OttoRouter environment fallback and OpenCode model binding precedence', async () => {
	// Isolate module mocks from other provider suites in the same Bun process.
	const script = `
		import { mock } from 'bun:test';
		import { strict as assert } from 'node:assert';
		const providers = await import('@ottocode/sdk/providers');
		const createProviderModel = providers.createProviderModel;
		const captured = [];
		mock.module('@ottocode/sdk/providers', () => ({
			...providers,
			createProviderModel(provider, model, config) {
				if (provider === 'ottorouter') {
					captured.push(config);
					return { provider, model };
				}
				return createProviderModel(provider, model, config);
			},
		}));
		mock.module('./packages/server/src/routes/ottorouter/service.ts', () => ({
			getOttoRouterOAuthAuth: async () => ({ accessToken: 'fixture' }),
		}));
		const { resolveModel } = await import('./packages/server/src/runtime/provider/index.ts');
		const { withRequestCredentials } = await import('./packages/server/src/runtime/provider/credentials.ts');
		const cfg = { projectRoot: '/tmp/provider-baseurl-fixture', providers: {} };
		process.env.OTTOROUTER_BASE_URL = 'https://env-router.example/v1';
		await resolveModel('ottorouter', 'fixture', cfg);
		assert.equal(captured[0].baseURL, 'https://env-router.example/v1');
		cfg.providers.ottorouter = { baseURL: 'https://configured-router.example/v1' };
		await resolveModel('ottorouter', 'fixture', cfg);
		assert.equal(captured[1].baseURL, 'https://configured-router.example/v1');

		providers.catalog.opencode.models['fixture-binding'] = {
			id: 'fixture-binding',
			provider: { npm: '@ai-sdk/openai-compatible', baseURL: 'https://bound-opencode.example/v1' },
		};
		const urls = [];
		globalThis.fetch = async (input) => {
			urls.push(input instanceof Request ? input.url : String(input));
			return new Response('{"error":{"message":"fixture"}}', {
				status: 400, headers: { 'content-type': 'application/json' },
			});
		};
		async function invoke() {
			const model = await withRequestCredentials({ opencode: { apiKey: 'fixture-key' } },
				() => resolveModel('opencode', 'fixture-binding', cfg));
			try {
				await model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
			} catch {}
		}
		await invoke();
		assert.equal(urls[0], 'https://bound-opencode.example/v1/chat/completions');
		cfg.providers.opencode = { baseURL: 'https://configured-opencode.example/v1' };
		await invoke();
		assert.equal(urls[1], 'https://configured-opencode.example/v1/chat/completions');
	`;
	const child = Bun.spawn([process.execPath, '-e', script], {
		cwd: process.cwd(),
		env: { ...process.env, OTTO_PROVIDER_REQUEST_MAX_RETRIES: '0' },
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: '', stderr: '' });
});
