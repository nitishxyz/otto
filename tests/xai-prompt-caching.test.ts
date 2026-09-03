import { describe, expect, test } from 'bun:test';
import { createXaiCacheAffinityFetch } from '../packages/sdk/src/providers/src/xai-client.ts';

describe('xAI prompt cache affinity', () => {
	test('adds prompt_cache_key to Responses requests', async () => {
		let requestBody: Record<string, unknown> | undefined;
		const baseFetch = (async (_input, init) => {
			requestBody = JSON.parse(String(init?.body));
			return new Response('{}');
		}) as typeof fetch;
		const cachingFetch = createXaiCacheAffinityFetch(
			baseFetch,
			'session-123',
			true,
		);

		await cachingFetch('https://api.x.ai/v1/responses', {
			method: 'POST',
			body: JSON.stringify({ model: 'grok-4.6' }),
		});

		expect(requestBody?.prompt_cache_key).toBe('session-123');
	});

	test('adds x-grok-conv-id to Chat Completions requests', async () => {
		let requestHeaders: Headers | undefined;
		const baseFetch = (async (_input, init) => {
			requestHeaders = new Headers(init?.headers);
			return new Response('{}');
		}) as typeof fetch;
		const cachingFetch = createXaiCacheAffinityFetch(baseFetch, 'session-123');

		await cachingFetch('https://api.x.ai/v1/chat/completions', {
			method: 'POST',
			body: JSON.stringify({ model: 'grok-3' }),
		});

		expect(requestHeaders?.get('x-grok-conv-id')).toBe('session-123');
	});

	test('preserves caller-provided affinity values', async () => {
		let requestBody: Record<string, unknown> | undefined;
		const baseFetch = (async (_input, init) => {
			requestBody = JSON.parse(String(init?.body));
			return new Response('{}');
		}) as typeof fetch;
		const cachingFetch = createXaiCacheAffinityFetch(
			baseFetch,
			'session-123',
			true,
		);

		await cachingFetch('https://api.x.ai/v1/responses', {
			method: 'POST',
			body: JSON.stringify({ prompt_cache_key: 'custom-key' }),
		});

		expect(requestBody?.prompt_cache_key).toBe('custom-key');
	});
});
