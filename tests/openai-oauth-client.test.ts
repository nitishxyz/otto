import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { streamText } from 'ai';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OAuth } from '../packages/sdk/src/types/src/index.ts';
import {
	clearOpenAIOAuthSessionState,
	createOpenAIOAuthFetch,
	createOpenAIOAuthModel,
	getOpenAIOAuthSessionState,
} from '../packages/sdk/src/providers/src/openai-oauth-client.ts';
import type { OpenAIOAuthWebSocketFactory } from '../packages/sdk/src/providers/src/openai-oauth-websocket.ts';
import { updateTodosTool } from '../packages/sdk/src/core/src/tools/builtin/todos.ts';

const TEST_OAUTH: OAuth = {
	type: 'oauth',
	access: 'access-token',
	refresh: 'refresh-token',
	expires: Date.now() + 10 * 60_000,
	accountId: 'acct_123',
};

class FakeWebSocket extends EventTarget {
	readyState = WebSocket.CONNECTING;
	readonly sent: string[] = [];

	constructor(readonly onSend?: (body: string, socket: FakeWebSocket) => void) {
		super();
	}

	open() {
		this.readyState = WebSocket.OPEN;
		this.dispatchEvent(new Event('open'));
	}

	send(body: string) {
		this.sent.push(body);
		this.onSend?.(body, this);
	}

	message(payload: unknown) {
		this.dispatchEvent(
			new MessageEvent('message', { data: JSON.stringify(payload) }),
		);
	}

	close(code = 1000, reason = '') {
		if (this.readyState === WebSocket.CLOSED) return;
		this.readyState = WebSocket.CLOSED;
		this.dispatchEvent(new CloseEvent('close', { code, reason }));
	}

	failConnection() {
		this.dispatchEvent(new Event('error'));
	}
}

function websocketFactory(
	create: () => FakeWebSocket,
	connections: FakeWebSocket[],
	headers?: Array<Record<string, string>>,
): OpenAIOAuthWebSocketFactory {
	return (_url, options) => {
		const socket = create();
		connections.push(socket);
		headers?.push(options.headers);
		queueMicrotask(() => socket.open());
		return socket as unknown as WebSocket;
	};
}

const WEBSOCKET_REQUEST_BODY = JSON.stringify({
	model: 'gpt-5.6-sol',
	store: false,
	stream: true,
	input: [{ role: 'user', content: 'hello' }],
});

function secureAuthPathForHome(home: string) {
	if (process.platform === 'darwin') {
		return join(home, 'Library', 'Application Support', 'otto', 'auth.json');
	}
	if (process.platform === 'win32') {
		return join(home, 'AppData', 'Roaming', 'otto', 'auth.json');
	}
	return join(home, '.local', 'state', 'otto', 'auth.json');
}

describe('openai oauth client', () => {
	const originalFetch = globalThis.fetch;
	const originalHome = process.env.HOME;
	const originalXdgStateHome = process.env.XDG_STATE_HOME;
	const originalAppData = process.env.APPDATA;

	beforeEach(() => {
		clearOpenAIOAuthSessionState();
		process.env.OTTO_OPENAI_OAUTH_TRANSPORT = 'http';
		delete process.env.OTTO_OPENAI_OAUTH_PREVIOUS_RESPONSE_ID;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_MAX_RETRIES;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_RETRY_DELAY_MS;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_TIMEOUT_MS;
		delete process.env.OTTO_OPENAI_OAUTH_STREAM_IDLE_TIMEOUT_MS;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
		else process.env.XDG_STATE_HOME = originalXdgStateHome;
		if (originalAppData === undefined) delete process.env.APPDATA;
		else process.env.APPDATA = originalAppData;
		clearOpenAIOAuthSessionState();
		delete process.env.OTTO_OPENAI_OAUTH_TRANSPORT;
		delete process.env.OTTO_OPENAI_OAUTH_PREVIOUS_RESPONSE_ID;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_MAX_RETRIES;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_RETRY_DELAY_MS;
		delete process.env.OTTO_OPENAI_OAUTH_REQUEST_TIMEOUT_MS;
		delete process.env.OTTO_OPENAI_OAUTH_STREAM_IDLE_TIMEOUT_MS;
	});

	test('defaults OAuth function tools to non-strict without changing schemas or explicit modes', async () => {
		const tools = [
			{
				type: 'function',
				name: 'update_todos',
				parameters: {
					type: 'object',
					properties: { todos: { type: 'array' }, note: { type: 'string' } },
					required: ['todos'],
				},
			},
			{ type: 'function', name: 'strict_tool', strict: true },
			{ type: 'function', name: 'non_strict_tool', strict: false },
			{ type: 'web_search' },
			{ type: 'custom', name: 'custom_tool' },
		];
		const requests: Array<{ tools: unknown[] }> = [];
		globalThis.fetch = async (_url, init) => {
			requests.push(JSON.parse(String(init?.body)));
			return new Response('data: [DONE]\n\n', {
				headers: { 'content-type': 'text/event-stream' },
			});
		};
		for (const sessionId of [undefined, 'session-tool-defaults']) {
			const customFetch = createOpenAIOAuthFetch({
				oauth: TEST_OAUTH,
				sessionId,
			});
			const response = await customFetch(
				'https://api.openai.com/v1/responses',
				{
					method: 'POST',
					body: JSON.stringify({ model: 'gpt-6-astra', tools }),
				},
			);
			await response.text();
		}
		expect(requests).toHaveLength(2);
		for (const request of requests) {
			expect(request.tools).toEqual([
				{ ...tools[0], strict: false },
				...tools.slice(1),
			]);
		}
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

	test('times out Codex responses that return headers but no stream chunks', async () => {
		process.env.OTTO_OPENAI_OAUTH_STREAM_IDLE_TIMEOUT_MS = '1';

		let callCount = 0;
		globalThis.fetch = async () => {
			callCount += 1;
			return new Response(
				new ReadableStream<Uint8Array>({
					start() {},
				}),
				{ headers: { 'content-type': 'text/event-stream' } },
			);
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-stream-start-retry',
		});

		const response = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({ model: 'gpt-5.3-codex', input: [] }),
		});

		await expect(response.text()).rejects.toThrow(
			'OpenAI OAuth Codex stream idle timeout',
		);
		expect(callCount).toBe(1);
	});

	test('returns a readable original 401 body when auth retry fails', async () => {
		process.env.OTTO_OPENAI_OAUTH_REQUEST_MAX_RETRIES = '1';
		process.env.OTTO_OPENAI_OAUTH_REQUEST_RETRY_DELAY_MS = '1';
		const tempHome = await mkdtemp(join(tmpdir(), 'otto-openai-oauth-'));
		delete process.env.XDG_STATE_HOME;
		delete process.env.APPDATA;
		process.env.HOME = tempHome;
		const authPath = secureAuthPathForHome(tempHome);
		await mkdir(authPath.slice(0, authPath.lastIndexOf('/')), {
			recursive: true,
		});
		await writeFile(
			authPath,
			JSON.stringify({
				openai: {
					...TEST_OAUTH,
					access: 'newer-access-token',
				},
			}),
		);

		let codexCalls = 0;
		globalThis.fetch = async (input) => {
			if (!String(input).includes('/backend-api/codex/responses')) {
				throw new Error('Refresh should not be called');
			}
			codexCalls += 1;
			if (codexCalls === 1) {
				return Response.json(
					{ error: { message: 'Unauthorized' } },
					{ status: 401 },
				);
			}
			throw new Error('Retry request failed');
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-readable-401',
		});

		const response = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: JSON.stringify({ model: 'gpt-5.3-codex', input: [] }),
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({
			error: { message: 'Unauthorized' },
		});
		expect(codexCalls).toBe(3);
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

	test('streams Codex responses over one reusable websocket', async () => {
		process.env.OTTO_OPENAI_OAUTH_TRANSPORT = 'websocket';
		const connections: FakeWebSocket[] = [];
		const handshakeHeaders: Array<Record<string, string>> = [];
		let responseNumber = 0;
		const factory = websocketFactory(
			() =>
				new FakeWebSocket((_body, socket) => {
					responseNumber += 1;
					queueMicrotask(() => {
						socket.message({
							type: 'response.created',
							response: {
								id: `resp_ws_${responseNumber}`,
								status: 'in_progress',
								model: 'gpt-5.6-sol',
							},
						});
						socket.message({
							type: 'response.output_text.delta',
							item_id: `item_${responseNumber}`,
							delta: `ok-${responseNumber}`,
						});
						socket.message({
							type: 'response.completed',
							response: {
								id: `resp_ws_${responseNumber}`,
								status: 'completed',
							},
						});
					});
				}),
			connections,
			handshakeHeaders,
		);
		globalThis.fetch = async () => {
			throw new Error('HTTP should not be used');
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-websocket',
			webSocketFactory: factory,
		});
		const first = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: WEBSOCKET_REQUEST_BODY,
		});
		const firstBody = await first.text();
		const nextFetchForSameSession = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-websocket',
			webSocketFactory: factory,
		});
		const second = await nextFetchForSameSession(
			'https://api.openai.com/v1/responses',
			{
				method: 'POST',
				body: WEBSOCKET_REQUEST_BODY,
			},
		);
		const secondBody = await second.text();

		expect(connections).toHaveLength(1);
		expect(connections[0]?.sent).toHaveLength(2);
		expect(first.headers.get('x-otto-openai-transport')).toBe('websocket');
		expect(firstBody).toContain('ok-1');
		expect(firstBody).toEndWith('data: [DONE]\n\n');
		expect(secondBody).toContain('ok-2');
		expect(handshakeHeaders[0]?.['openai-beta']).toBe(
			'responses_websockets=2026-02-06',
		);
		const frame = JSON.parse(connections[0]?.sent[0] ?? '{}');
		expect(frame).toMatchObject({
			type: 'response.create',
			model: 'gpt-5.6-sol',
			store: false,
			stream: true,
			client_metadata: { session_id: 'session-websocket' },
		});
		expect(getOpenAIOAuthSessionState('session-websocket')).toMatchObject({
			responseId: 'resp_ws_2',
			status: 'completed',
		});
	});

	test('closes a one-off websocket after the response completes', async () => {
		process.env.OTTO_OPENAI_OAUTH_TRANSPORT = 'websocket';
		const connections: FakeWebSocket[] = [];
		const factory = websocketFactory(
			() =>
				new FakeWebSocket((_body, socket) => {
					queueMicrotask(() => {
						socket.message({
							type: 'response.completed',
							response: { id: 'resp_once', status: 'completed' },
						});
					});
				}),
			connections,
		);
		globalThis.fetch = async () => {
			throw new Error('HTTP should not be used');
		};
		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			webSocketFactory: factory,
		});

		const response = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: WEBSOCKET_REQUEST_BODY,
		});

		expect(await response.text()).toEndWith('data: [DONE]\n\n');
		expect(connections).toHaveLength(1);
		expect(connections[0]?.readyState).toBe(WebSocket.CLOSED);
	});

	test('falls back to HTTP for the session when websocket setup fails', async () => {
		process.env.OTTO_OPENAI_OAUTH_TRANSPORT = 'auto';
		const connections: FakeWebSocket[] = [];
		const factory: OpenAIOAuthWebSocketFactory = () => {
			const socket = new FakeWebSocket();
			connections.push(socket);
			queueMicrotask(() => socket.failConnection());
			return socket as unknown as WebSocket;
		};
		let httpRequests = 0;
		globalThis.fetch = async () => {
			httpRequests += 1;
			return new Response('data: [DONE]\n\n', {
				headers: { 'content-type': 'text/event-stream' },
			});
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-auto-fallback',
			webSocketFactory: factory,
		});
		const first = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: WEBSOCKET_REQUEST_BODY,
		});
		const second = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: WEBSOCKET_REQUEST_BODY,
		});

		expect(await first.text()).toBe('data: [DONE]\n\n');
		expect(await second.text()).toBe('data: [DONE]\n\n');
		expect(connections).toHaveLength(1);
		expect(httpRequests).toBe(2);
	});

	test('falls back to HTTP when websocket rejects the request', async () => {
		process.env.OTTO_OPENAI_OAUTH_TRANSPORT = 'auto';
		const connections: FakeWebSocket[] = [];
		const factory = websocketFactory(
			() =>
				new FakeWebSocket((_body, socket) => {
					queueMicrotask(() => {
						socket.message({
							type: 'error',
							status: 404,
							error: { code: 'not_found', message: 'Not Found' },
						});
					});
				}),
			connections,
		);
		let httpRequests = 0;
		globalThis.fetch = async () => {
			httpRequests += 1;
			return new Response('data: [DONE]\n\n', {
				headers: { 'content-type': 'text/event-stream' },
			});
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-request-fallback',
			webSocketFactory: factory,
		});
		const response = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: WEBSOCKET_REQUEST_BODY,
		});

		expect(await response.text()).toBe('data: [DONE]\n\n');
		expect(connections).toHaveLength(1);
		expect(httpRequests).toBe(1);
	});

	test('feeds websocket events through the OpenAI AI SDK model', async () => {
		process.env.OTTO_OPENAI_OAUTH_TRANSPORT = 'websocket';
		const connections: FakeWebSocket[] = [];
		const factory = websocketFactory(
			() =>
				new FakeWebSocket((_body, socket) => {
					queueMicrotask(() => {
						socket.message({
							type: 'response.created',
							response: {
								id: 'resp_sdk',
								created_at: 1_700_000_000,
								model: 'gpt-5.6-sol',
							},
						});
						socket.message({
							type: 'response.output_item.added',
							output_index: 0,
							item: { type: 'message', id: 'msg_sdk' },
						});
						socket.message({
							type: 'response.output_text.delta',
							item_id: 'msg_sdk',
							delta: 'SDK_OK',
						});
						socket.message({
							type: 'response.output_item.done',
							output_index: 0,
							item: { type: 'message', id: 'msg_sdk' },
						});
						socket.message({
							type: 'response.completed',
							response: {
								id: 'resp_sdk',
								status: 'completed',
								usage: {
									input_tokens: 1,
									output_tokens: 1,
								},
							},
						});
					});
				}),
			connections,
		);
		globalThis.fetch = async () => {
			throw new Error('HTTP should not be used');
		};
		const model = createOpenAIOAuthModel('gpt-5.6-sol', {
			oauth: TEST_OAUTH,
			sessionId: 'session-sdk-websocket',
			webSocketFactory: factory,
		});

		const result = streamText({
			model,
			prompt: 'Reply with SDK_OK',
			providerOptions: { openai: { store: false } },
		});

		expect(await result.text).toBe('SDK_OK');
		expect(connections).toHaveLength(1);
	});

	test('streams and executes the first OAuth todo call with optional note omitted', async () => {
		process.env.OTTO_OPENAI_OAUTH_TRANSPORT = 'websocket';
		const connections: FakeWebSocket[] = [];
		const input = {
			todos: [{ step: 'Inspect the project', status: 'in_progress' }],
		};
		const argumentsText = JSON.stringify(input);
		const item = {
			type: 'function_call',
			id: 'fc_todo',
			call_id: 'call_todo',
			name: 'update_todos',
		};
		const factory = websocketFactory(
			() =>
				new FakeWebSocket((_body, socket) => {
					queueMicrotask(() => {
						socket.message({
							type: 'response.created',
							response: {
								id: 'resp_todo',
								created_at: 1_700_000_000,
								model: 'gpt-6-astra',
							},
						});
						socket.message({
							type: 'response.output_item.added',
							output_index: 0,
							item: { ...item, arguments: '' },
						});
						for (const delta of [
							argumentsText.slice(0, 15),
							argumentsText.slice(15),
						]) {
							socket.message({
								type: 'response.function_call_arguments.delta',
								item_id: item.id,
								output_index: 0,
								delta,
							});
						}
						socket.message({
							type: 'response.function_call_arguments.done',
							item_id: item.id,
							output_index: 0,
							arguments: argumentsText,
						});
						socket.message({
							type: 'response.output_item.done',
							output_index: 0,
							item: { ...item, arguments: argumentsText, status: 'completed' },
						});
						socket.message({
							type: 'response.completed',
							response: {
								id: 'resp_todo',
								status: 'completed',
								usage: { input_tokens: 1, output_tokens: 1 },
							},
						});
					});
				}),
			connections,
		);
		const model = createOpenAIOAuthModel('gpt-6-astra', {
			oauth: TEST_OAUTH,
			sessionId: 'session-first-todo',
			webSocketFactory: factory,
		});
		const result = streamText({
			model,
			prompt: 'Plan the task',
			tools: { update_todos: updateTodosTool },
			providerOptions: { openai: { store: false } },
		});
		const parts = [];
		for await (const part of result.fullStream) parts.push(part);
		expect(parts.filter((part) => part.type === 'error')).toEqual([]);
		expect(parts.map((part) => part.type)).toContain('tool-input-start');
		expect(parts.map((part) => part.type)).toContain('tool-input-delta');
		expect(parts.map((part) => part.type)).toContain('tool-result');
		expect(await result.finishReason).toBe('tool-calls');
		const [toolResult] = await result.toolResults;
		expect(toolResult.input).toEqual(input);
		expect(toolResult.output).toMatchObject({ ok: true, remaining: 1 });
		const frame = JSON.parse(connections[0].sent[0]);
		expect(frame.tools[0].strict).toBe(false);
		expect(frame.tools[0].parameters.required).toEqual(['todos']);
	});

	test('uses HTTP on the next request after a websocket stream disconnects', async () => {
		process.env.OTTO_OPENAI_OAUTH_TRANSPORT = 'auto';
		const connections: FakeWebSocket[] = [];
		const factory = websocketFactory(
			() =>
				new FakeWebSocket((_body, socket) => {
					queueMicrotask(() => {
						socket.message({
							type: 'response.created',
							response: {
								id: 'resp_disconnected',
								status: 'in_progress',
								model: 'gpt-5.6-sol',
							},
						});
						socket.close(1006, 'connection lost');
					});
				}),
			connections,
		);
		let httpRequests = 0;
		globalThis.fetch = async () => {
			httpRequests += 1;
			return new Response('data: [DONE]\n\n', {
				headers: { 'content-type': 'text/event-stream' },
			});
		};

		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-stream-fallback',
			webSocketFactory: factory,
		});
		const first = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: WEBSOCKET_REQUEST_BODY,
		});
		await expect(first.text()).rejects.toThrow(
			'WebSocket closed before response.completed',
		);
		const second = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: WEBSOCKET_REQUEST_BODY,
		});

		expect(await second.text()).toBe('data: [DONE]\n\n');
		expect(connections).toHaveLength(1);
		expect(httpRequests).toBe(1);
	});

	test('does not disable websocket after a caller aborts a stream', async () => {
		process.env.OTTO_OPENAI_OAUTH_TRANSPORT = 'auto';
		const connections: FakeWebSocket[] = [];
		let requestNumber = 0;
		const factory = websocketFactory(
			() =>
				new FakeWebSocket((_body, socket) => {
					requestNumber += 1;
					queueMicrotask(() => {
						if (requestNumber === 1) {
							socket.message({
								type: 'response.created',
								response: { id: 'resp_aborted', status: 'in_progress' },
							});
							return;
						}
						socket.message({
							type: 'response.completed',
							response: { id: 'resp_after_abort', status: 'completed' },
						});
					});
				}),
			connections,
		);
		globalThis.fetch = async () => {
			throw new Error('HTTP should not be used');
		};
		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-aborted-websocket',
			webSocketFactory: factory,
		});
		const abortController = new AbortController();
		const first = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: WEBSOCKET_REQUEST_BODY,
			signal: abortController.signal,
		});

		abortController.abort();
		await expect(first.text()).rejects.toThrow();
		const second = await customFetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			body: WEBSOCKET_REQUEST_BODY,
		});

		expect(await second.text()).toEndWith('data: [DONE]\n\n');
		expect(connections).toHaveLength(2);
	});

	test('preserves websocket disconnect details through the AI SDK stream', async () => {
		process.env.OTTO_OPENAI_OAUTH_TRANSPORT = 'auto';
		const connections: FakeWebSocket[] = [];
		const factory = websocketFactory(
			() =>
				new FakeWebSocket((_body, socket) => {
					queueMicrotask(() => {
						socket.message({
							type: 'response.created',
							response: {
								id: 'resp_sdk_disconnected',
								created_at: 1_700_000_000,
								model: 'gpt-5.6-sol',
							},
						});
						socket.close(1006, 'connection lost');
					});
				}),
			connections,
		);
		const model = createOpenAIOAuthModel('gpt-5.6-sol', {
			oauth: TEST_OAUTH,
			sessionId: 'session-sdk-disconnect',
			webSocketFactory: factory,
		});
		const result = streamText({
			model,
			prompt: 'hello',
			providerOptions: { openai: { store: false } },
		});

		let streamError: unknown;
		try {
			for await (const _part of result.fullStream) {
				// consume until the transport failure reaches the runner-facing stream
			}
		} catch (error) {
			streamError = error;
		}
		expect(streamError).toBeInstanceOf(Error);
		expect((streamError as Error).message).toContain(
			'OpenAI OAuth Codex WebSocket closed before response.completed',
		);
	});

	test('does not silently use HTTP in forced websocket mode', async () => {
		process.env.OTTO_OPENAI_OAUTH_TRANSPORT = 'websocket';
		let httpRequests = 0;
		globalThis.fetch = async () => {
			httpRequests += 1;
			return new Response('data: [DONE]\n\n');
		};
		const factory: OpenAIOAuthWebSocketFactory = () => {
			const socket = new FakeWebSocket();
			queueMicrotask(() => socket.failConnection());
			return socket as unknown as WebSocket;
		};
		const customFetch = createOpenAIOAuthFetch({
			oauth: TEST_OAUTH,
			sessionId: 'session-websocket-only',
			webSocketFactory: factory,
		});

		await expect(
			customFetch('https://api.openai.com/v1/responses', {
				method: 'POST',
				body: WEBSOCKET_REQUEST_BODY,
			}),
		).rejects.toThrow('Failed to connect OpenAI OAuth Codex WebSocket');
		expect(httpRequests).toBe(0);
	});
});
