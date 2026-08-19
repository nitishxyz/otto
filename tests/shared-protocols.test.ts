import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_AUDIO_FORMAT,
	dictationClientMessageSchema,
	dictationServerEventSchema,
	encodeDictationClientMessage,
	encodeDictationServerEvent,
	parseDictationClientMessage,
	parseDictationServerEvent,
	type DictationClientMessage,
	type DictationServerEvent,
} from '@ottocode/sdk/dictation/protocol';
import {
	clientEventSchema,
	parseClientEventJson,
	parseServerEventJson,
	serverEventTypeSchema,
	type ClientEvent,
	type ServerEvent,
	type ServerEventPayloadMap,
	type ServerEventType,
} from '@ottocode/sdk/events/protocol';
import {
	parseClientEvent as parseApiClientEvent,
	parseServerEvent as parseApiServerEvent,
} from '../packages/api/src/streaming.ts';

const shellJob = {
	id: 'job-1',
	sessionId: 'session-1',
	messageId: 'message-1',
	command: 'echo ok',
	cwd: '/project',
	status: 'completed' as const,
	detached: false,
	output: 'ok',
	exitCode: 0,
	result: { ok: true },
	reported: true,
	createdAt: 1,
	updatedAt: 2,
	completedAt: 2,
};

const payloadFixtures = {
	'tool.approval.required': {
		callId: 'call-1',
		toolName: 'shell',
		args: { command: 'pwd' },
		messageId: 'message-1',
	},
	'tool.approval.updated': {
		callId: 'call-1',
		toolName: 'shell',
		args: { command: 'pwd' },
		messageId: 'message-1',
	},
	'tool.approval.resolved': {
		callId: 'call-1',
		toolName: 'shell',
		approved: true,
		reason: 'user_approved',
	},
	'shell.secure_input.required': {
		promptId: 'prompt-1',
		messageId: 'message-1',
		callId: 'call-1',
		prompt: 'Password',
		inputKind: 'password',
		allowRemember: false,
	},
	'shell.secure_input.resolved': {
		promptId: 'prompt-1',
		messageId: 'message-1',
		callId: 'call-1',
		cancelled: false,
		reason: 'user_submitted',
	},
	'ottorouter.payment.required': { amountUsd: 1, currentBalance: 0 },
	'ottorouter.payment.signing': {},
	'ottorouter.payment.complete': { amountUsd: 1, newBalance: 10 },
	'ottorouter.payment.error': { error: 'declined' },
	'ottorouter.topup.required': {
		messageId: 'message-1',
		amountUsd: 1,
		currentBalance: 0,
		minTopupUsd: 5,
		suggestedTopupUsd: 5,
	},
	'ottorouter.topup.method_selected': { method: 'fiat' },
	'ottorouter.topup.cancelled': { reason: 'cancelled' },
	'ottorouter.fiat.checkout_created': {
		messageId: 'message-1',
		needsTopup: true,
	},
	'ottorouter.balance.updated': { costUsd: 1, balanceRemaining: 9 },
	'session.created': { id: 'session-1', title: 'New session' },
	'session.deleted': { id: 'session-1' },
	'session.updated': { id: 'session-1', title: 'Updated session' },
	'message.created': {
		id: 'message-1',
		role: 'assistant',
		provider: 'openai',
		model: 'gpt-test',
	},
	'message.updated': { id: 'message-1', status: 'complete' },
	'message.part.delta': {
		messageId: 'message-1',
		partId: 'part-1',
		delta: 'hello',
	},
	'reasoning.delta': {
		messageId: 'message-1',
		partId: 'part-2',
		stepIndex: 0,
		delta: 'thinking',
	},
	'message.completed': { id: 'message-1', finishReason: 'stop' },
	'tool.call': {
		name: 'shell',
		callId: 'call-1',
		messageId: 'message-1',
		args: { command: 'pwd' },
	},
	'tool.delta': {
		name: 'shell',
		channel: 'output',
		delta: 'ok',
		messageId: 'message-1',
		callId: 'call-1',
	},
	'tool.result': {
		name: 'shell',
		callId: 'call-1',
		messageId: 'message-1',
		result: { exitCode: 0 },
	},
	'shell.job.updated': { job: shellJob },
	'shell.job.output': { jobId: 'job-1', delta: 'ok', updatedAt: 2 },
	'plan.updated': {
		items: [{ step: 'Ship it', status: 'in_progress' }],
		note: 'working',
	},
	'goal.updated': { goalId: 'goal-1', changes: ['goal completed'] },
	'finish-step': { stepIndex: 0, finishReason: 'tool-calls' },
	usage: { stepIndex: 0, inputTokens: 10, outputTokens: 5 },
	'queue.updated': {
		currentMessageId: 'message-1',
		queuedMessages: [],
		queueLength: 0,
		isRunning: true,
	},
	error: {
		messageId: 'message-1',
		error: 'failed',
		errorType: 'provider_error',
		isAborted: false,
	},
	heartbeat: { createdAt: '2026-08-18T00:00:00.000Z' },
} satisfies ServerEventPayloadMap;

const clientFixtures = [
	{
		type: 'notification',
		payload: {
			id: 'notification-1',
			level: 'info',
			title: 'Done',
			createdAt: '2026-08-18T00:00:00.000Z',
		},
	},
	{
		type: 'session.status',
		payload: {
			sessionId: 'session-1',
			status: 'running',
			createdAt: '2026-08-18T00:00:00.000Z',
		},
	},
	{
		type: 'reference.preparation',
		payload: {
			name: 'setu',
			url: 'https://example.com/setu.git',
			ref: 'main',
			projectRoot: '/project',
			status: 'available',
			output: ['ready'],
		},
	},
	{
		type: 'heartbeat',
		payload: { createdAt: '2026-08-18T00:00:00.000Z' },
	},
] satisfies ClientEvent[];

describe('canonical event protocol', () => {
	test('round-trips every published server event type through SDK and API', () => {
		const eventTypes = serverEventTypeSchema.options;
		expect(eventTypes).toHaveLength(Object.keys(payloadFixtures).length);

		for (const type of eventTypes) {
			const event = {
				type,
				sessionId: 'session-1',
				projectId: 'project-1',
				projectRoot: '/project',
				payload: payloadFixtures[type],
			} as ServerEvent<ServerEventType>;
			const raw = JSON.stringify(event);
			expect(parseServerEventJson(raw)).toEqual(event);
			expect(parseApiServerEvent(raw)).toEqual(event);
		}
	});

	test('uses the real tool envelope and field names', () => {
		const event = parseServerEventJson(
			JSON.stringify({
				type: 'tool.call',
				sessionId: 'session-1',
				payload: payloadFixtures['tool.call'],
			}),
		);
		if (event.type !== 'tool.call') throw new Error('Expected tool.call');
		expect(event.payload.name).toBe('shell');
		expect(event.payload.callId).toBe('call-1');
		expect('toolName' in event.payload).toBe(false);
		expect('toolCallId' in event.payload).toBe(false);
	});

	test('round-trips every client event including reference preparation', () => {
		for (const event of clientFixtures) {
			const raw = JSON.stringify(event);
			expect(parseClientEventJson(raw)).toEqual(event);
			expect(parseApiClientEvent(raw)).toEqual(event);
			expect(clientEventSchema.parse(event)).toEqual(event);
		}
	});

	test('rejects malformed envelopes and payloads', () => {
		expect(parseApiServerEvent('{bad json')).toBeNull();
		expect(
			parseApiServerEvent(
				JSON.stringify({
					type: 'tool.call',
					sessionId: 'session-1',
					payload: { toolName: 'shell', toolCallId: 'call-1' },
				}),
			),
		).toBeNull();
		expect(
			parseApiClientEvent(
				JSON.stringify({
					type: 'reference.preparation',
					payload: { name: 'setu', status: 'available' },
				}),
			),
		).toBeNull();
	});
});

const clientMessages = [
	{
		type: 'start',
		model: 'small.en-q5_1',
		language: 'en',
		format: DEFAULT_AUDIO_FORMAT,
		partialResults: false,
	},
	{ type: 'stop' },
	{ type: 'cancel' },
] satisfies DictationClientMessage[];

const serverEvents = [
	{
		type: 'ready',
		sessionId: 'dictation-1',
		model: 'small.en-q5_1',
		format: DEFAULT_AUDIO_FORMAT,
	},
	{ type: 'recording', receivedMs: 100, receivedBytes: 3_200 },
	{
		type: 'final',
		text: 'hello',
		language: 'en',
		model: 'small.en-q5_1',
		durationMs: 100,
	},
	{
		type: 'error',
		code: 'DICTATION_TRANSCRIBE_FAILED',
		message: 'failed',
	},
] satisfies DictationServerEvent[];

describe('canonical dictation protocol', () => {
	test('round-trips every client and server discriminant', () => {
		for (const message of clientMessages) {
			const raw = encodeDictationClientMessage(message);
			expect(parseDictationClientMessage(raw)).toEqual(message);
			expect(dictationClientMessageSchema.parse(message)).toEqual(message);
		}
		for (const event of serverEvents) {
			const raw = encodeDictationServerEvent(event);
			expect(parseDictationServerEvent(raw)).toEqual(event);
			expect(dictationServerEventSchema.parse(event)).toEqual(event);
		}
	});

	test('rejects malformed discriminated variants', () => {
		expect(() =>
			parseDictationClientMessage('{"type":"start","format":{"channels":0}}'),
		).toThrow();
		expect(() =>
			parseDictationServerEvent(
				'{"type":"error","code":"UNKNOWN","message":"failed"}',
			),
		).toThrow();
		expect(
			dictationServerEventSchema.safeParse({
				type: 'ready',
				sessionId: 'dictation-1',
				model: 'small.en-q5_1',
				format: { encoding: 'mp3', sampleRate: 16_000, channels: 1 },
			}).success,
		).toBe(false);
	});
});
