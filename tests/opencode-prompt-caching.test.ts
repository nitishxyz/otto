import { describe, expect, test } from 'bun:test';
import { createOpencodeCachingFetch } from '../packages/sdk/src/providers/src/opencode-client.ts';

describe('OpenCode prompt cache affinity', () => {
	test('adds the session cache key for OpenAI-bound Zen models', async () => {
		let requestBody: Record<string, unknown> | undefined;
		const baseFetch = (async (_input, init) => {
			requestBody = JSON.parse(String(init?.body));
			return new Response('{}');
		}) as typeof fetch;
		const cachingFetch = createOpencodeCachingFetch('@ai-sdk/openai', {
			fetch: baseFetch,
			promptCacheKey: 'session-123',
		});

		await cachingFetch?.('https://opencode.ai/zen/v1/responses', {
			method: 'POST',
			body: JSON.stringify({ model: 'gpt-5.6-sol' }),
		});

		expect(requestBody?.prompt_cache_key).toBe('session-123');
	});

	test('does not add OpenAI cache fields to Anthropic-bound models', async () => {
		let requestBody: Record<string, unknown> | undefined;
		const baseFetch = (async (_input, init) => {
			requestBody = JSON.parse(String(init?.body));
			return new Response('{}');
		}) as typeof fetch;
		const cachingFetch = createOpencodeCachingFetch('@ai-sdk/anthropic', {
			fetch: baseFetch,
			promptCacheKey: 'session-123',
		});

		await cachingFetch?.('https://opencode.ai/zen/v1/messages', {
			method: 'POST',
			body: JSON.stringify({
				model: 'claude-fable-5',
				system: [{ type: 'text', text: 'stable prompt' }],
			}),
		});

		expect(requestBody?.prompt_cache_key).toBeUndefined();
		expect(
			(requestBody?.system as Array<Record<string, unknown>>)?.[0]
				?.cache_control,
		).toEqual({ type: 'ephemeral' });
	});
});
