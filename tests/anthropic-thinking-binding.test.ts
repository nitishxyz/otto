import { describe, expect, test } from 'bun:test';
import { createAnthropicCachingFetch } from '../packages/sdk/src/providers/src/anthropic-caching.ts';

function captureFetch() {
	const calls: { body: Record<string, unknown>; headers: Headers }[] = [];
	const fetchFn = (async (_input: unknown, init?: RequestInit) => {
		calls.push({
			body: JSON.parse(String(init?.body)),
			headers: new Headers(init?.headers),
		});
		return new Response('{}');
	}) as unknown as typeof fetch;
	return { calls, fetchFn };
}

describe('anthropic thinking block binding', () => {
	test('opts adaptive thinking into drop_block on the first-party API', async () => {
		const { calls, fetchFn } = captureFetch();
		await createAnthropicCachingFetch(fetchFn)(
			'https://api.anthropic.com/v1/messages',
			{
				method: 'POST',
				headers: { 'anthropic-beta': 'foo-beta' },
				body: JSON.stringify({ thinking: { type: 'adaptive' }, messages: [] }),
			},
		);
		expect(calls[0]?.body.thinking).toEqual({
			type: 'adaptive',
			block_binding: { prefix_mismatch_behavior: 'drop_block' },
		});
		expect(calls[0]?.headers.get('anthropic-beta')).toBe(
			'foo-beta,thinking-binding-controls-2026-08-01',
		);
	});

	test('leaves requests without thinking or to proxies untouched', async () => {
		const { calls, fetchFn } = captureFetch();
		const cachingFetch = createAnthropicCachingFetch(fetchFn);
		await cachingFetch('https://api.anthropic.com/v1/messages', {
			body: JSON.stringify({ messages: [] }),
		});
		await cachingFetch('https://proxy.example.com/v1/messages', {
			body: JSON.stringify({ thinking: { type: 'adaptive' }, messages: [] }),
		});
		expect(calls[0]?.body.thinking).toBeUndefined();
		expect(calls[0]?.headers.get('anthropic-beta')).toBeNull();
		expect(calls[1]?.body.thinking).toEqual({ type: 'adaptive' });
	});
});
