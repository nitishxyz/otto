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
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		clearOpenAIOAuthSessionState();
		delete process.env.OTTO_OPENAI_OAUTH_PREVIOUS_RESPONSE_ID;
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

	test('replays Codex turn state and identity headers', async () => {
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
		expect(requestHeaders[0]?.get('x-codex-window-id')).toBe(
			'session-headers:0',
		);
		expect(requestHeaders[0]?.get('thread_id')).toBe('session-headers');
		expect(requestHeaders[1]?.get('x-codex-turn-state')).toBe('turn-state-1');
		expect(requestHeaders[1]?.get('x-codex-installation-id')).toBe(
			requestHeaders[0]?.get('x-codex-installation-id'),
		);
		expect(JSON.parse(requestBodies[0] ?? '{}')).toMatchObject({
			client_metadata: {
				'x-codex-installation-id': requestHeaders[0]?.get(
					'x-codex-installation-id',
				),
			},
			prompt_cache_key: 'session-headers',
		});
		expect(getOpenAIOAuthSessionState('session-headers')).toMatchObject({
			turnState: 'turn-state-1',
			installationId: requestHeaders[0]?.get('x-codex-installation-id'),
			windowId: 'session-headers:0',
		});
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
