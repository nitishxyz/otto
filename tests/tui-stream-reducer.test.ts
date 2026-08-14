import { describe, expect, test } from 'bun:test';
import {
	messageReducer,
	type StreamAction,
} from '../apps/tui/src/stream/reducer.ts';
import type { Message } from '../apps/tui/src/types.ts';

function makeMessage(overrides: Partial<Message> = {}): Message {
	return {
		id: 'msg-1',
		sessionId: 's-1',
		role: 'assistant',
		status: 'pending',
		agent: 'build',
		provider: 'anthropic',
		model: 'claude',
		createdAt: 1000,
		completedAt: null,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		error: null,
		parts: [],
		...overrides,
	};
}

function reduce(state: Message[], ...actions: StreamAction[]): Message[] {
	return actions.reduce(messageReducer, state);
}

describe('TUI stream reducer', () => {
	test('CLEAR empties state', () => {
		expect(reduce([makeMessage()], { type: 'CLEAR' })).toEqual([]);
	});

	test('PREPEND adds older messages without duplicating loaded ids', () => {
		const current = makeMessage({ id: 'new', createdAt: 2000 });
		const older = makeMessage({ id: 'old', createdAt: 1000 });
		const state = reduce([current], {
			type: 'PREPEND',
			messages: [older, structuredClone(current)],
		});
		expect(state.map((message) => message.id)).toEqual(['old', 'new']);
		expect(state[1]).toBe(current);
	});

	test('RETRY_MESSAGE clears stale error state and terminal parts', () => {
		const failed = makeMessage({
			status: 'error',
			error: 'provider failed',
			completedAt: 2000,
			parts: [
				{ id: 'text', type: 'text', content: 'partial response' },
				{ id: 'error', type: 'error', content: 'provider failed' },
				{ id: 'finish', type: 'tool_call', toolName: 'finish' },
			] as Message['parts'],
		});
		const state = reduce([failed], {
			type: 'RETRY_MESSAGE',
			messageId: failed.id,
		});
		expect(state[0]).toMatchObject({
			status: 'pending',
			error: null,
			completedAt: null,
		});
		expect(state[0].parts?.map((part) => part.id)).toEqual(['text']);
	});

	test('REFRESH_LATEST updates the live edge without dropping older pages', () => {
		const older = makeMessage({ id: 'old', createdAt: 1000 });
		const latest = makeMessage({
			id: 'latest',
			createdAt: 2000,
			status: 'complete',
		});
		const refreshed = makeMessage({
			id: 'latest',
			createdAt: 2000,
			status: 'error',
			error: 'failed',
		});
		const appended = makeMessage({ id: 'newest', createdAt: 3000 });
		const state = reduce([older, latest], {
			type: 'REFRESH_LATEST',
			messages: [refreshed, appended],
		});
		expect(state.map((message) => message.id)).toEqual([
			'old',
			'latest',
			'newest',
		]);
		expect(state[0]).toBe(older);
		expect(state[1]).toBe(refreshed);
	});

	test('ADD_OPTIMISTIC_USER appends a complete user message with text part', () => {
		const state = reduce([], {
			type: 'ADD_OPTIMISTIC_USER',
			id: 'optimistic-1',
			content: 'hello',
			attachmentNames: ['a.png'],
		});
		expect(state).toHaveLength(1);
		expect(state[0].role).toBe('user');
		expect(state[0].status).toBe('complete');
		expect(state[0].attachmentNames).toEqual(['a.png']);
		expect(state[0].parts?.[0]?.contentJson).toEqual({ text: 'hello' });
	});

	test('ADD_OPTIMISTIC_USER is idempotent per id', () => {
		const action: StreamAction = {
			type: 'ADD_OPTIMISTIC_USER',
			id: 'optimistic-1',
			content: 'hello',
		};
		expect(reduce([], action, action)).toHaveLength(1);
	});

	test('MESSAGE_CREATED reconciles optimistic user message id', () => {
		const state = reduce(
			[],
			{ type: 'ADD_OPTIMISTIC_USER', id: 'optimistic-1', content: 'hi' },
			{
				type: 'MESSAGE_CREATED',
				payload: { id: 'real-1', role: 'user', content: 'hi' },
			},
		);
		expect(state).toHaveLength(1);
		expect(state[0].id).toBe('real-1');
		expect(state[0].parts?.[0]?.messageId).toBe('real-1');
	});

	test('MESSAGE_CREATED immediately renders a remote user message text', () => {
		const state = reduce([], {
			type: 'MESSAGE_CREATED',
			payload: {
				id: 'remote-user-1',
				sessionId: 's-1',
				role: 'user',
				status: 'complete',
				content: 'sent from another client',
				createdAt: 1234,
				completedAt: 1234,
			},
		});

		expect(state).toHaveLength(1);
		expect(state[0].status).toBe('complete');
		expect(state[0].createdAt).toBe(1234);
		expect(state[0].parts?.[0]?.contentJson).toEqual({
			text: 'sent from another client',
		});
	});

	test('MESSAGE_CREATED reconciles only the optimistic message with matching text', () => {
		const state = reduce(
			[],
			{ type: 'ADD_OPTIMISTIC_USER', id: 'optimistic-1', content: 'first' },
			{ type: 'ADD_OPTIMISTIC_USER', id: 'optimistic-2', content: 'second' },
			{
				type: 'MESSAGE_CREATED',
				payload: { id: 'real-2', role: 'user', content: 'second' },
			},
		);

		expect(state).toHaveLength(2);
		expect(state.map((message) => message.id)).toEqual([
			'optimistic-1',
			'real-2',
		]);
		expect(state[1].parts?.[0]?.contentJson).toEqual({ text: 'second' });
	});

	test('MESSAGE_CREATED consumes one optimistic copy for identical sends', () => {
		const state = reduce(
			[],
			{ type: 'ADD_OPTIMISTIC_USER', id: 'optimistic-1', content: 'same' },
			{ type: 'ADD_OPTIMISTIC_USER', id: 'optimistic-2', content: 'same' },
			{
				type: 'MESSAGE_CREATED',
				payload: { id: 'real-1', role: 'user', content: 'same' },
			},
		);

		expect(state.map((message) => message.id)).toEqual([
			'real-1',
			'optimistic-2',
		]);
	});

	test('MESSAGE_CREATED appends assistant message', () => {
		const state = reduce([], {
			type: 'MESSAGE_CREATED',
			payload: { id: 'a-1', role: 'assistant', agent: 'plan' },
		});
		expect(state).toHaveLength(1);
		expect(state[0].status).toBe('pending');
		expect(state[0].agent).toBe('plan');
	});

	test('TEXT_DELTA creates then appends to a text part', () => {
		const base = [makeMessage({ id: 'a-1' })];
		const state = reduce(
			base,
			{
				type: 'TEXT_DELTA',
				payload: { messageId: 'a-1', partId: 'p-1', delta: 'Hel' },
			},
			{
				type: 'TEXT_DELTA',
				payload: { messageId: 'a-1', partId: 'p-1', delta: 'lo' },
			},
		);
		expect(state[0].parts).toHaveLength(1);
		expect(state[0].parts?.[0]?.contentJson).toEqual({ text: 'Hello' });
		expect(state[0].parts?.[0]?.type).toBe('text');
	});

	test('TEXT_DELTA for unknown message is a no-op', () => {
		const base = [makeMessage({ id: 'a-1' })];
		const state = reduce(base, {
			type: 'TEXT_DELTA',
			payload: { messageId: 'nope', partId: 'p-1', delta: 'x' },
		});
		expect(state).toBe(base);
	});

	test('REASONING_DELTA creates a reasoning part', () => {
		const state = reduce([makeMessage({ id: 'a-1' })], {
			type: 'REASONING_DELTA',
			payload: { messageId: 'a-1', partId: 'r-1', delta: 'thinking' },
		});
		expect(state[0].parts?.[0]?.type).toBe('reasoning');
	});

	test('TOOL_CALL adds ephemeral part targeting streaming assistant', () => {
		const state = reduce([makeMessage({ id: 'a-1' })], {
			type: 'TOOL_CALL',
			payload: { callId: 'c-1', name: 'read', args: { path: 'x.ts' } },
		});
		const part = state[0].parts?.[0];
		expect(part?.type).toBe('tool_call');
		expect(part?.toolCallId).toBe('c-1');
		expect(part?.ephemeral).toBe(true);
		expect(part?.contentJson?.args).toEqual({ path: 'x.ts' });
	});

	test('TOOL_CALL updates existing ephemeral part for same callId', () => {
		const state = reduce(
			[makeMessage({ id: 'a-1' })],
			{
				type: 'TOOL_CALL',
				payload: { callId: 'c-1', name: 'read' },
			},
			{
				type: 'TOOL_CALL',
				payload: { callId: 'c-1', name: 'read', args: { path: 'y.ts' } },
			},
		);
		expect(state[0].parts).toHaveLength(1);
		expect(state[0].parts?.[0]?.contentJson?.args).toEqual({ path: 'y.ts' });
	});

	test('TOOL_DELTA only applies for input channel', () => {
		const base = [makeMessage({ id: 'a-1' })];
		const ignored = reduce(base, {
			type: 'TOOL_DELTA',
			payload: { channel: 'output', callId: 'c-1', name: 'shell' },
		});
		expect(ignored).toBe(base);
		const applied = reduce(base, {
			type: 'TOOL_DELTA',
			payload: { channel: 'input', callId: 'c-1', name: 'shell' },
		});
		expect(applied[0].parts).toHaveLength(1);
	});

	test('TOOL_DELTA output channel accumulates outputStream on running part', () => {
		const state = reduce(
			[makeMessage({ id: 'a-1' })],
			{
				type: 'TOOL_CALL',
				payload: { callId: 'c-1', name: 'shell' },
			},
			{
				type: 'TOOL_DELTA',
				payload: { channel: 'output', callId: 'c-1', delta: 'line 1\n' },
			},
			{
				type: 'TOOL_DELTA',
				payload: { channel: 'output', callId: 'c-1', delta: 'line 2\n' },
			},
		);
		expect(state[0].parts?.[0]?.contentJson?.outputStream).toBe(
			'line 1\nline 2\n',
		);
	});

	test('TOOL_DELTA input channel accumulates _streamedInput on the part', () => {
		const state = reduce(
			[makeMessage({ id: 'a-1' })],
			{
				type: 'TOOL_DELTA',
				payload: {
					channel: 'input',
					callId: 'c-1',
					name: 'write',
					delta: '{"path":"foo.ts","content":"hel',
				},
			},
			{
				type: 'TOOL_DELTA',
				payload: {
					channel: 'input',
					callId: 'c-1',
					name: 'write',
					delta: 'lo\\nworld"}',
				},
			},
		);
		const part = state[0].parts?.[0];
		expect(part?.toolName).toBe('write');
		expect(part?.contentJson?._streamedInput).toBe(
			'{"path":"foo.ts","content":"hello\\nworld"}',
		);
	});

	test('TOOL_DELTA output for completed or unknown call is a no-op', () => {
		const base = reduce(
			[makeMessage({ id: 'a-1' })],
			{ type: 'TOOL_CALL', payload: { callId: 'c-1', name: 'shell' } },
			{ type: 'TOOL_RESULT', payload: { callId: 'c-1', result: {} } },
		);
		const after = reduce(base, {
			type: 'TOOL_DELTA',
			payload: { channel: 'output', callId: 'c-1', delta: 'late' },
		});
		expect(after).toBe(base);
	});

	test('TOOL_RESULT completes the ephemeral part with duration and result', () => {
		const state = reduce(
			[makeMessage({ id: 'a-1' })],
			{
				type: 'TOOL_CALL',
				payload: { callId: 'c-1', name: 'read' },
			},
			{
				type: 'TOOL_RESULT',
				payload: { callId: 'c-1', result: { ok: true } },
			},
		);
		const part = state[0].parts?.[0];
		expect(part?.completedAt).not.toBeNull();
		expect(part?.toolDurationMs).not.toBeNull();
		expect(part?.contentJson?.result).toEqual({ ok: true });
	});

	test('MESSAGE_COMPLETED marks complete and records tokens', () => {
		const state = reduce([makeMessage({ id: 'a-1' })], {
			type: 'MESSAGE_COMPLETED',
			payload: { id: 'a-1', totalTokens: 123, completionTokens: 45 },
		});
		expect(state[0].status).toBe('complete');
		expect(state[0].totalTokens).toBe(123);
		expect(state[0].completionTokens).toBe(45);
	});

	test('MESSAGE_UPDATED updates status', () => {
		const state = reduce([makeMessage({ id: 'a-1' })], {
			type: 'MESSAGE_UPDATED',
			payload: { id: 'a-1', status: 'error' },
		});
		expect(state[0].status).toBe('error');
	});

	test('ERROR with messageId marks that message errored', () => {
		const state = reduce([makeMessage({ id: 'a-1' })], {
			type: 'ERROR',
			payload: { messageId: 'a-1', error: 'boom' },
		});
		expect(state[0].status).toBe('error');
		expect(state[0].error).toBe('boom');
	});

	test('ERROR without messageId appends synthetic error message', () => {
		const state = reduce([], {
			type: 'ERROR',
			payload: { error: 'kaput' },
		});
		expect(state).toHaveLength(1);
		expect(state[0].status).toBe('error');
		expect(state[0].parts?.[0]?.type).toBe('error');
	});

	test('LOAD keeps local streaming assistant copy over server snapshot', () => {
		const local = makeMessage({
			id: 'a-1',
			status: 'pending',
			parts: [
				{
					id: 'p-1',
					messageId: 'a-1',
					index: 0,
					stepIndex: null,
					type: 'text',
					content: JSON.stringify({ text: 'streamed ahead' }),
					contentJson: { text: 'streamed ahead' },
					agent: '',
					provider: '',
					model: '',
					startedAt: 1,
					completedAt: null,
					toolName: null,
					toolCallId: null,
					toolDurationMs: null,
				},
			],
		});
		const serverCopy = makeMessage({ id: 'a-1', status: 'pending', parts: [] });
		const state = reduce([local], {
			type: 'LOAD',
			messages: [serverCopy],
		});
		expect(state[0]).toBe(local);
	});

	test('LOAD drops an optimistic message matched by server text', () => {
		const state = reduce(
			[],
			{ type: 'ADD_OPTIMISTIC_USER', id: 'optimistic-1', content: 'hi' },
			{
				type: 'LOAD',
				messages: [
					makeMessage({
						id: 'u-1',
						role: 'user',
						parts: [
							{
								id: 'u-1-text',
								messageId: 'u-1',
								index: 0,
								stepIndex: null,
								type: 'text',
								content: JSON.stringify({ text: 'hi' }),
								contentJson: { text: 'hi' },
								agent: '',
								provider: '',
								model: '',
								startedAt: 1,
								completedAt: 1,
								toolName: null,
								toolCallId: null,
								toolDurationMs: null,
							},
						],
					}),
				],
			},
		);
		expect(state).toHaveLength(1);
		expect(state[0].id).toBe('u-1');
	});

	test('LOAD keeps optimistic messages not represented by server text', () => {
		const state = reduce(
			[],
			{ type: 'ADD_OPTIMISTIC_USER', id: 'optimistic-1', content: 'pending' },
			{
				type: 'LOAD',
				messages: [makeMessage({ id: 'u-1', role: 'user' })],
			},
		);
		expect(state.map((message) => message.id)).toEqual(['u-1', 'optimistic-1']);
	});

	test('LOAD keeps optimistic messages when server has no user messages yet', () => {
		const state = reduce(
			[],
			{ type: 'ADD_OPTIMISTIC_USER', id: 'optimistic-1', content: 'hi' },
			{ type: 'LOAD', messages: [] },
		);
		expect(state).toHaveLength(1);
		expect(state[0].id).toBe('optimistic-1');
	});
});
