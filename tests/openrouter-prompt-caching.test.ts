import { describe, expect, test } from 'bun:test';
import { createOpenRouterCachingFetch } from '../packages/sdk/src/providers/src/openrouter-client.ts';

describe('OpenRouter prompt cache affinity', () => {
	test('adds router stickiness and upstream cache affinity', async () => {
		let requestBody: Record<string, unknown> | undefined;
		const baseFetch = (async (_input, init) => {
			requestBody = JSON.parse(String(init?.body));
			return new Response('{}');
		}) as typeof fetch;
		const cachingFetch = createOpenRouterCachingFetch(baseFetch, 'session-123');

		await cachingFetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			body: JSON.stringify({ model: 'x-ai/grok-4.6' }),
		});

		expect(requestBody?.session_id).toBe('session-123');
		expect(requestBody?.prompt_cache_key).toBe('session-123');
	});

	test('preserves caller-provided affinity values', async () => {
		let requestBody: Record<string, unknown> | undefined;
		const baseFetch = (async (_input, init) => {
			requestBody = JSON.parse(String(init?.body));
			return new Response('{}');
		}) as typeof fetch;
		const cachingFetch = createOpenRouterCachingFetch(baseFetch, 'session-123');

		await cachingFetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			body: JSON.stringify({
				session_id: 'router-key',
				prompt_cache_key: 'provider-key',
			}),
		});

		expect(requestBody?.session_id).toBe('router-key');
		expect(requestBody?.prompt_cache_key).toBe('provider-key');
	});
});
