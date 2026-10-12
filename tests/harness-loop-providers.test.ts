import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { createBuiltInProviderModel } from '../packages/sdk/src/providers/src/model-factory.ts';
import { resolveModel as resolveSdkModel } from '../packages/sdk/src/core/src/providers/resolver.ts';
import { getSecureAuthPath } from '../packages/sdk/src/config/src/paths.ts';
import { getAnthropicInstance } from '../packages/server/src/runtime/provider/anthropic.ts';
import type { OttoConfig } from '@ottocode/sdk';
import { createOpenRouterModel } from '../packages/sdk/src/providers/src/openrouter-client.ts';

type Captured = { url: string; headers: Headers };

function capturingFetch(captured: Captured[]): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.href
					: input.url;
		captured.push({ url, headers: new Headers(init?.headers) });
		return new Response(JSON.stringify({ error: { message: 'stop' } }), {
			status: 400,
			headers: { 'content-type': 'application/json' },
		});
	}) as typeof fetch;
}

async function invoke(model: unknown) {
	const languageModel = model as LanguageModelV3;
	expect(typeof languageModel.doGenerate).toBe('function');
	try {
		await languageModel.doGenerate({
			prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
		});
	} catch {}
}

const MATRIX: Array<{ provider: string; model: string }> = [
	{ provider: 'openai', model: 'gpt-4.1' },
	{ provider: 'anthropic', model: 'claude-sonnet-4-5' },
	{ provider: 'google', model: 'gemini-2.5-pro' },
	{ provider: 'openrouter', model: 'openai/gpt-4.1' },
	{ provider: 'deepseek', model: 'deepseek-chat' },
	{ provider: 'zai', model: 'glm-4.6' },
	{ provider: 'minimax', model: 'MiniMax-M2' },
];

describe('provider factory forwarding matrix', () => {
	test('ordinary OpenRouter wrapper forwards baseURL and retains cache/stickiness', async () => {
		const captured: Captured[] = [];
		const bodies: string[] = [];
		const fetchCapture = capturingFetch(captured);
		const customFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			bodies.push(String(init?.body));
			return fetchCapture(input, init);
		}) as typeof fetch;
		await invoke(
			createOpenRouterModel('openai/gpt-4.1', {
				apiKey: 'router-key',
				baseURL: 'https://router-proxy.example/v1',
				fetch: customFetch,
				promptCacheKey: 'session-affinity',
			}),
		);
		expect(captured[0]?.url).toBe(
			'https://router-proxy.example/v1/chat/completions',
		);
		expect(captured[0]?.headers.get('authorization')).toBe('Bearer router-key');
		expect(JSON.parse(bodies[0]).session_id).toBe('session-affinity');
		expect(JSON.parse(bodies[0]).prompt_cache_key).toBe('session-affinity');
	});
	test('built-in OpenRouter factory retains ordinary wrapper request shaping through custom fetch', async () => {
		const bodies: string[] = [];
		const captured: Captured[] = [];
		const fetchCapture = capturingFetch(captured);
		const customFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			bodies.push(String(init?.body));
			return fetchCapture(input, init);
		}) as typeof fetch;
		await invoke(
			createBuiltInProviderModel('openrouter', 'anthropic/claude-sonnet-4', {
				apiKey: 'router-key',
				baseURL: 'https://router-proxy.example/v1',
				customFetch,
			}),
		);
		expect(captured[0]?.url).toBe(
			'https://router-proxy.example/v1/chat/completions',
		);
		await invoke(
			createOpenRouterModel('anthropic/claude-sonnet-4', {
				apiKey: 'router-key',
				baseURL: 'https://router-proxy.example/v1',
				fetch: customFetch,
			}),
		);
		expect(JSON.parse(bodies[0])).toEqual(JSON.parse(bodies[1]));
	});
	for (const entry of MATRIX) {
		test(`${entry.provider}: apiKey + customFetch + baseURL reach the request`, async () => {
			const captured: Captured[] = [];
			const baseURL = `https://proxy.example.test/${entry.provider}/v1`;
			const model = createBuiltInProviderModel(
				entry.provider as never,
				entry.model,
				{
					apiKey: 'test-key-123',
					customFetch: capturingFetch(captured),
					baseURL,
				},
			);
			await invoke(model);
			expect(captured.length).toBeGreaterThan(0);
			expect(captured[0].url.startsWith(baseURL)).toBe(true);
			const headerValues = Array.from(captured[0].headers.values()).join(' ');
			expect(headerValues).toContain('test-key-123');
		});
	}

	test('sdk resolver returns a model (not a factory) for anthropic + customFetch', async () => {
		const captured: Captured[] = [];
		const model = await resolveSdkModel('anthropic', 'claude-sonnet-4-5', {
			apiKey: 'anthropic-key',
			customFetch: capturingFetch(captured),
		});
		expect(typeof model).toBe('object');
		await invoke(model);
		expect(captured[0]?.headers.get('x-api-key')).toBe('anthropic-key');
	});
});

describe('server anthropic provider auth', () => {
	const originalHome = process.env.HOME;
	const originalKey = process.env.ANTHROPIC_API_KEY;
	const originalFetch = globalThis.fetch;
	let home = '';

	afterEach(async () => {
		process.env.HOME = originalHome;
		if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
		else process.env.ANTHROPIC_API_KEY = originalKey;
		globalThis.fetch = originalFetch;
		if (home) await rm(home, { recursive: true, force: true });
	});

	async function withStoredAuth(auth: unknown) {
		home = await mkdtemp(join(tmpdir(), 'otto-harness-auth-'));
		process.env.HOME = home;
		const authPath = getSecureAuthPath();
		await mkdir(dirname(authPath), { recursive: true });
		await writeFile(authPath, JSON.stringify(auth));
	}

	const cfg = { projectRoot: '/tmp/otto-harness-anthropic' } as OttoConfig;

	test('stored API key is used for requests', async () => {
		await withStoredAuth({ anthropic: { type: 'api', key: 'stored-key' } });
		delete process.env.ANTHROPIC_API_KEY;
		const captured: Captured[] = [];
		globalThis.fetch = capturingFetch(captured);
		const instance = await getAnthropicInstance(cfg);
		await invoke(instance('claude-sonnet-4-5'));
		expect(captured[0]?.headers.get('x-api-key')).toBe('stored-key');
	});

	test('falls back to ANTHROPIC_API_KEY without stored auth', async () => {
		await withStoredAuth({});
		process.env.ANTHROPIC_API_KEY = 'env-key';
		const captured: Captured[] = [];
		globalThis.fetch = capturingFetch(captured);
		const instance = await getAnthropicInstance(cfg);
		await invoke(instance('claude-sonnet-4-5'));
		expect(captured[0]?.headers.get('x-api-key')).toBe('env-key');
	});
});
