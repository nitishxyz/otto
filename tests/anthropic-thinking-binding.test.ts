import { describe, expect, test } from 'bun:test';
import { createAnthropicCachingFetch } from '../packages/sdk/src/providers/src/anthropic-caching.ts';

function captureFetch(responses: Response[] = []) {
	const calls: { body: Record<string, unknown>; headers: Headers }[] = [];
	const fetchFn = (async (_input: unknown, init?: RequestInit) => {
		calls.push({
			body: JSON.parse(String(init?.body)),
			headers: new Headers(init?.headers),
		});
		return responses.shift() ?? new Response('{}');
	}) as unknown as typeof fetch;
	return { calls, fetchFn };
}

const bindingMessage =
	'messages.5.content.94: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Content that preceded this block when it was created is missing from this request, starting at `messages.110.content.1`.';

function apiError(message = bindingMessage, status = 400) {
	return Response.json(
		{ type: 'error', error: { type: 'invalid_request_error', message } },
		{ status },
	);
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

	test.each([
		{ type: 'adaptive' },
		{ type: 'enabled', budget_tokens: 2048 },
		{ type: 'disabled' },
		undefined,
	])('recovers binding errors with thinking config %j', async (thinking) => {
		const success = new Response('streamed response');
		const { calls, fetchFn } = captureFetch([apiError(), success]);
		const text = { type: 'text', text: 'Keep this answer' };
		const tool = { type: 'tool_use', id: 'call-1', name: 'read', input: {} };
		const result = {
			type: 'tool_result',
			tool_use_id: 'call-1',
			content: 'ok',
		};
		const messages = [
			{ role: 'user', content: 'hello' },
			{
				role: 'assistant',
				content: [
					{ type: 'thinking', thinking: 'old reasoning', signature: 'bound' },
					text,
					{ type: 'redacted_thinking', data: 'encrypted' },
					tool,
				],
			},
			{ role: 'user', content: [result] },
			{
				role: 'assistant',
				content: [{ type: 'thinking', thinking: 'more', signature: 'bound-2' }],
			},
			{ role: 'user', content: 'continue' },
		];
		const body = JSON.stringify({
			model: 'claude-opus-5-5',
			thinking,
			messages,
		});
		const response = await createAnthropicCachingFetch(fetchFn)(
			'https://api.anthropic.com/v1/messages',
			{ method: 'POST', headers: { 'x-api-key': 'test-key' }, body },
		);
		expect(response).toBe(success);
		expect(await response.text()).toBe('streamed response');
		expect(calls).toHaveLength(2);
		expect(calls[1]?.body.messages).toEqual([
			messages[0],
			{ role: 'assistant', content: [text, tool] },
			messages[2],
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: 'continue',
						cache_control: { type: 'ephemeral' },
					},
				],
			},
		]);
		expect(calls[1]?.body.thinking).toEqual(calls[0]?.body.thinking);
		expect(calls[1]?.headers.get('x-api-key')).toBe('test-key');
		expect(calls[1]?.headers.get('anthropic-beta')).toBe(
			calls[0]?.headers.get('anthropic-beta'),
		);
		expect(JSON.parse(body).messages).toEqual(messages);
	});

	test('does not loop if the recovery request also fails', async () => {
		const secondError = apiError();
		const { calls, fetchFn } = captureFetch([apiError(), secondError]);
		const response = await createAnthropicCachingFetch(fetchFn)(
			'https://api.anthropic.com/v1/messages',
			{
				body: JSON.stringify({
					messages: [
						{
							role: 'assistant',
							content: [
								{ type: 'thinking', thinking: 'old', signature: 'bound' },
								{ type: 'text', text: 'answer' },
							],
						},
					],
				}),
			},
		);
		expect(response).toBe(secondError);
		expect(calls).toHaveLength(2);
		expect((await response.json()).error.message).toBe(bindingMessage);
	});

	test.each([
		['https://proxy.example.com/v1/messages', bindingMessage, 400],
		['https://api.anthropic.com/v1/messages', 'Invalid `signature`', 400],
		['https://api.anthropic.com/v1/messages', bindingMessage, 500],
	])(
		'does not retry other errors or proxies (%s, %s, %d)',
		async (url, message, status) => {
			const error = apiError(message, status);
			const { calls, fetchFn } = captureFetch([error]);
			const response = await createAnthropicCachingFetch(fetchFn)(url, {
				body: JSON.stringify({
					messages: [
						{
							role: 'assistant',
							content: [
								{ type: 'thinking', thinking: 'old', signature: 'bound' },
							],
						},
					],
				}),
			});
			expect(response).toBe(error);
			expect(calls).toHaveLength(1);
			expect((await response.json()).error.message).toBe(message);
		},
	);

	test('does not retry when no thinking can be removed or the error is not JSON', async () => {
		for (const error of [
			apiError(),
			new Response('not JSON', { status: 400 }),
		]) {
			const { calls, fetchFn } = captureFetch([error]);
			const response = await createAnthropicCachingFetch(fetchFn)(
				'https://api.anthropic.com/v1/messages',
				{
					body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
				},
			);
			expect(response).toBe(error);
			expect(calls).toHaveLength(1);
			expect(response.bodyUsed).toBe(false);
		}
	});
});
