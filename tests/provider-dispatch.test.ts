import { describe, expect, test } from 'bun:test';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { BuiltInProviderId } from '@ottocode/sdk';
import {
	createProviderModel,
	createConfiguredProviderModel,
} from '@ottocode/sdk/providers';
import { resolveModel } from '../packages/sdk/src/core/src/providers/resolver.ts';
import type { ResolvedProviderDefinition } from '../packages/sdk/src/providers/src/registry.ts';

function capture() {
	const requests: {
		url: string;
		headers: Headers;
		body: Record<string, unknown>;
	}[] = [];
	const customFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		requests.push({
			url: input instanceof Request ? input.url : String(input),
			headers: new Headers(init?.headers),
			body: JSON.parse(String(init?.body)),
		});
		return new Response('{"error":{"message":"fixture"}}', {
			status: 400,
			headers: { 'content-type': 'application/json' },
		});
	}) as typeof fetch;
	return { requests, customFetch };
}

async function invoke(model: unknown) {
	try {
		await (model as LanguageModelV3).doGenerate({
			prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
		});
	} catch {}
}

const matrix: [BuiltInProviderId, string][] = [
	['openai', 'gpt-5'],
	['anthropic', 'claude-sonnet-4-5'],
	['google', 'gemini-2.5-pro'],
	['openrouter', 'openai/gpt-4.1'],
	['deepseek', 'deepseek-chat'],
	['zai', 'glm-4.6'],
	['zai-coding', 'glm-4.6'],
	['minimax', 'MiniMax-M2'],
	['kimi', 'kimi-k2'],
	['xai', 'grok-3'],
	['opencode', 'unknown-model'],
];

describe('canonical provider dispatch', () => {
	for (const [provider, model] of matrix) {
		test(`${provider} forwards key, baseURL and custom fetch through SDK resolver`, async () => {
			const { requests, customFetch } = capture();
			const resolved = await resolveModel(provider, model, {
				apiKey: 'dispatch-key',
				baseURL: 'https://dispatch.example/v1',
				customFetch,
				sessionId: 'affinity',
			});
			await invoke(resolved);
			expect(requests.length).toBeGreaterThan(0);
			expect(requests[0].url.startsWith('https://dispatch.example/v1')).toBe(
				true,
			);
			expect([...requests[0].headers.values()].join(' ')).toContain(
				'dispatch-key',
			);
			if (provider === 'openrouter') {
				expect(requests[0].body.session_id).toBe('affinity');
				expect(requests[0].body.prompt_cache_key).toBe('affinity');
			}
		});
	}

	test('standalone Anthropic OAuth uses explicit identity and supplied fetch', async () => {
		const { requests, customFetch } = capture();
		await invoke(
			createProviderModel('anthropic', 'claude-sonnet-4-5', {
				oauth: {
					type: 'oauth',
					access: 'explicit-access',
					refresh: 'explicit-refresh',
					expires: Date.now() + 3600000,
				},
				authMode: 'standalone',
				customFetch,
			}),
		);
		expect(requests[0]?.headers.get('authorization')).toBe(
			'Bearer explicit-access',
		);
		expect(requests[0]?.headers.has('x-api-key')).toBe(false);
	});

	test('OpenAI OAuth forwards supplied HTTP transport and session identity', async () => {
		const { requests, customFetch } = capture();
		await invoke(
			createProviderModel('openai', 'gpt-5', {
				oauth: {
					type: 'oauth',
					access: 'codex-access',
					refresh: 'codex-refresh',
					expires: Date.now() + 3600000,
				},
				customFetch,
				sessionId: 'dispatch-codex',
			}),
		);
		expect(requests[0]?.url).toContain(
			'chatgpt.com/backend-api/codex/responses',
		);
		expect(requests[0]?.headers.get('authorization')).toBe(
			'Bearer codex-access',
		);
		expect(requests[0]?.headers.get('session_id')).toBe('dispatch-codex');
	});

	test('Copilot retains OAuth transport and supplied fetch', async () => {
		const { requests, customFetch } = capture();
		await invoke(
			createProviderModel('copilot', 'gpt-4.1', {
				oauth: {
					type: 'oauth',
					access: 'access',
					refresh: 'copilot-token',
					expires: 0,
				},
				customFetch,
			}),
		);
		expect(requests[0]?.url).toContain('api.githubcopilot.com');
		expect(requests[0]?.headers.get('authorization')).toBe(
			'Bearer copilot-token',
		);
	});

	for (const compatibility of [
		'openai',
		'anthropic',
		'google',
		'openrouter',
		'ollama',
		'openai-compatible',
	] as const) {
		test(`configured ${compatibility} forwards binding and fetch`, async () => {
			const { requests, customFetch } = capture();
			const definition: ResolvedProviderDefinition = {
				id: 'fixture',
				label: 'fixture',
				source: 'custom',
				compatibility,
				family: 'default',
				allowAnyModel: true,
				baseURL: 'https://unused.example/v1',
				models: {
					alias: {
						id: 'alias',
						provider: {
							id: 'bound-model',
							baseURL: 'https://bound.example/v1',
						},
					},
				},
			};
			await invoke(
				createConfiguredProviderModel(definition, 'alias', {
					apiKey: 'custom-key',
					customFetch,
					reasoningText: true,
				}),
			);
			expect(requests[0]?.url).toContain('bound.example');
			expect([...requests[0].headers.values()].join(' ')).toContain(
				'custom-key',
			);
			if (compatibility !== 'google')
				expect(requests[0].body.model).toBe('bound-model');
		});
	}
});
