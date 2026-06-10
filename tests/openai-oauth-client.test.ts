import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { OAuth } from '../packages/sdk/src/types/src/index.ts';
import {
	clearOpenAIOAuthSessionState,
	createOpenAIOAuthFetch,
	getOpenAIOAuthSessionState,
} from '../packages/sdk/src/providers/src/openai-oauth-client.ts';

const TEST_OAUTH: OAuth = {
	type: 'oauth',
	access: 'access-token',
	refresh: 'refresh-token',
	expires: Date.now() + 10 * 60_000,
	accountId: 'acct_123',
};

describe('openai oauth client', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		clearOpenAIOAuthSessionState();
		delete process.env.OTTO_OPENAI_OAUTH_PREVIOUS_RESPONSE_ID;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_MAX_RETRIES;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_RETRY_DELAY_MS;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_TIMEOUT_MS;
		delete process.env.OTTO_OPENAI_OAUTH_STREAM_IDLE_TIMEOUT_MS;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		clearOpenAIOAuthSessionState();
		delete process.env.OTTO_OPENAI_OAUTH_PREVIOUS_RESPONSE_ID;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_MAX_RETRIES;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_RETRY_DELAY_MS;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_TIMEOUT_MS;
		delete process.env.OTTO_OPENAI_OAUTH_STREAM_IDLE_TIMEOUT_MS;
	});

	test('tracks response ids from the Codex responses stream', async () => {
		globalThis.fetch = async () =>
			new Response(
				[
					'data: {"type":"response.created","response":{"id":"resp_1","status":"in_progress","model":"gpt-5.3-codex"}}\n\n',
					'data: {"type":"response.incomplete","response":{"id":"resp_1","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
					'data: [DONE]\n\n',
				].join(''),
				{
					headers: { 'content-type': 'text/event-stream' },
				},
			);

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-1',
		});

		const response = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({ model: 'gpt-5.3-codex', input: [] }),
		});

		await response.text();

		expect(getOpenAIOAuthSessionState('session-1')).toMatchObject({
			responseId: 'resp_1',
			model: 'gpt-5.3-codex',
			status: 'incomplete',
			incompleteReason: 'max_output_tokens',
		});
	});

	test('does not inject previous_response_id by default', async () => {
		const requestBodies: string[] = [];
		let callCount = 0;
		globalThis.fetch = async (_input, init) => {
			requestBodies.push(typeof init?.body === 'string' ? init.body : '');
			callCount += 1;
			const responseId = callCount === 1 ? 'resp_1' : 'resp_2';
			return new Response(
				[
					`data: {"type":"response.created","response":{"id":"${responseId}","status":"in_progress","model":"gpt-5.3-codex"}}\n\n`,
					`data: {"type":"response.completed","response":{"id":"${responseId}","status":"completed"}}\n\n`,
					'data: [DONE]\n\n',
				].join(''),
				{
					headers: { 'content-type': 'text/event-stream' },
				},
			);
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-2',
		});

		const first = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({
				model: 'gpt-5.3-codex',
				input: [{ role: 'user' }],
			}),
		});
		await first.text();

		const second = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({
				model: 'gpt-5.3-codex',
				input: [{ role: 'assistant' }],
			}),
		});
		await second.text();

		expect(JSON.parse(requestBodies[0] ?? '{}')).not.toHaveProperty(
			'previous_response_id',
		);
		expect(JSON.parse(requestBodies[1] ?? '{}')).not.toHaveProperty(
			'previous_response_id',
		);
		expect(getOpenAIOAuthSessionState('session-2')).toMatchObject({
			responseId: 'resp_2',
			model: 'gpt-5.3-codex',
			status: 'completed',
			incompleteReason: undefined,
		});
	});

	test('does not replay Codex turn state or stateful thread headers', async () => {
		const requestHeaders: Headers[] = [];
		const requestBodies: string[] = [];
		let callCount = 0;
		globalThis.fetch = async (_input, init) => {
			requestHeaders.push(new Headers(init?.headers));
			requestBodies.push(typeof init?.body === 'string' ? init.body : '');
			callCount += 1;
			const headers =
				callCount === 1 ? { 'x-codex-turn-state': 'turn-state-1' } : {};
			return new Response(
				[
					`data: {"type":"response.created","response":{"id":"resp_${callCount}","status":"in_progress","model":"gpt-5.3-codex"}}\n\n`,
					`data: {"type":"response.completed","response":{"id":"resp_${callCount}","status":"completed"}}\n\n`,
					'data: [DONE]\n\n',
				].join(''),
				{
					headers,
				},
			);
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-headers',
		});

		const first = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({ model: 'gpt-5.3-codex', input: [] }),
		});
		await first.text();

		const second = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({ model: 'gpt-5.3-codex', input: [] }),
		});
		await second.text();

		expect(requestHeaders[0]?.get('x-codex-turn-state')).toBeNull();
		expect(requestHeaders[0]?.get('x-codex-installation-id')).toBeTruthy();
		expect(requestHeaders[0]?.get('x-codex-window-id')).toBeNull();
		expect(requestHeaders[0]?.get('thread_id')).toBeNull();
		expect(requestHeaders[0]?.get('session_id')).toBe('session-headers');
		expect(requestHeaders[1]?.get('x-codex-turn-state')).toBeNull();
		expect(requestHeaders[1]?.get('x-codex-window-id')).toBeNull();
		expect(requestHeaders[1]?.get('thread_id')).toBeNull();
		const firstBody = JSON.parse(requestBodies[0] ?? '{}');
		expect(firstBody).not.toHaveProperty('client_metadata');
		expect(firstBody).toMatchObject({
			prompt_cache_key: 'session-headers',
		});
		expect(getOpenAIOAuthSessionState('session-headers')).toMatchObject({
			responseId: 'resp_2',
			model: 'gpt-5.3-codex',
			status: 'completed',
		});
	});

	test('strips response input ids for stateless Codex requests', async () => {
		const requestBodies: string[] = [];
		globalThis.fetch = async (_input, init) => {
			requestBodies.push(typeof init?.body === 'string' ? init.body : '');
			return new Response('data: [DONE]\n\n', {
				headers: { 'content-type': 'text/event-stream' },
			});
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-stateless',
		});

		await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({
				model: 'gpt-5.5',
				store: false,
				input: [
					{ id: 'msg_1', role: 'user', content: 'hello' },
					{ role: 'assistant', content: 'hi' },
				],
			}),
		});

		const payload = JSON.parse(requestBodies[0] ?? '{}');
		expect(payload.input[0]).not.toHaveProperty('id');
		expect(payload.input[0]).toMatchObject({
			role: 'user',
			content: 'hello',
		});
		expect(payload.input[1]).toMatchObject({
			role: 'assistant',
			content: 'hi',
		});
	});

	test('keeps response input ids when storage is explicitly enabled', async () => {
		const requestBodies: string[] = [];
		globalThis.fetch = async (_input, init) => {
			requestBodies.push(typeof init?.body === 'string' ? init.body : '');
			return new Response('data: [DONE]\n\n', {
				headers: { 'content-type': 'text/event-stream' },
			});
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-stored',
		});

		await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({
				model: 'gpt-5.5',
				store: true,
				input: [{ id: 'msg_1', role: 'user', content: 'hello' }],
			}),
		});

		const payload = JSON.parse(requestBodies[0] ?? '{}');
		expect(payload.input[0]).toMatchObject({
			id: 'msg_1',
			role: 'user',
			content: 'hello',
		});
	});

	test('retries timed-out Codex response requests before returning a stream', async () => {
		process.env.OTTO_OPENAI_OAUTH_REQUEST_TIMEOUT_MS = '1';
		process.env.OTTO_OPENAI_OAUTH_REQUEST_MAX_RETRIES = '3';
		process.env.OTTO_OPENAI_OAUTH_REQUEST_RETRY_DELAY_MS = '1';

		let callCount = 0;
		globalThis.fetch = async (_input, init) => {
			callCount += 1;
			if (callCount < 3) {
				return await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => reject(init.signal?.reason ?? new Error('aborted')),
						{ once: true },
					);
				});
			}

			return new Response('data: [DONE]\n\n', {
				headers: { 'content-type': 'text/event-stream' },
			});
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-retry',
		});

		const response = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({ model: 'gpt-5.3-codex', input: [] }),
		});

		expect(await response.text()).toBe('data: [DONE]\n\n');
		expect(callCount).toBe(3);
	});

	test('retries Codex responses that return headers but no stream chunks', async () => {
		process.env.OTTO_OPENAI_OAUTH_STREAM_IDLE_TIMEOUT_MS = '1';
		process.env.OTTO_OPENAI_OAUTH_REQUEST_MAX_RETRIES = '3';
		process.env.OTTO_OPENAI_OAUTH_REQUEST_RETRY_DELAY_MS = '1';

		let callCount = 0;
		globalThis.fetch = async () => {
			callCount += 1;
			if (callCount < 3) {
				return new Response(
					new ReadableStream<Uint8Array>({
						start() {},
					}),
					{ headers: { 'content-type': 'text/event-stream' } },
				);
			}

			return new Response('data: [DONE]\n\n', {
				headers: { 'content-type': 'text/event-stream' },
			});
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-stream-start-retry',
		});

		const response = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({ model: 'gpt-5.3-codex', input: [] }),
		});

		expect(await response.text()).toBe('data: [DONE]\n\n');
		expect(callCount).toBe(3);
	});

	test('injects previous_response_id when explicitly enabled', async () => {
		process.env.OTTO_OPENAI_OAUTH_PREVIOUS_RESPONSE_ID = '1';
		const requestBodies: string[] = [];
		let callCount = 0;
		globalThis.fetch = async (_input, init) => {
			requestBodies.push(typeof init?.body === 'string' ? init.body : '');
			callCount += 1;
			const responseId = callCount === 1 ? 'resp_1' : 'resp_2';
			return new Response(
				[
					`data: {"type":"response.created","response":{"id":"${responseId}","status":"in_progress","model":"gpt-5.3-codex"}}\n\n`,
					`data: {"type":"response.completed","response":{"id":"${responseId}","status":"completed"}}\n\n`,
					'data: [DONE]\n\n',
				].join(''),
				{
					headers: { 'content-type': 'text/event-stream' },
				},
			);
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-3',
		});

		const first = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({
				model: 'gpt-5.3-codex',
				input: [{ role: 'user' }],
			}),
		});
		await first.text();

		const second = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({
				model: 'gpt-5.3-codex',
				input: [{ role: 'assistant' }],
			}),
		});
		await second.text();

		expect(JSON.parse(requestBodies[1] ?? '{}')).toMatchObject({
			previous_response_id: 'resp_1',
		});
	});
});
