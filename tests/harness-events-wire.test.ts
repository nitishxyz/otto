import { describe, expect, test } from 'bun:test';
import {
	consumeSSEResponse,
	createSSEDecoder,
	decodeSSEEvent,
	parseClientEvent,
	parseServerEvent,
	type DecodedSSEEvent,
	type ClientEvent,
	type SSEEvent,
} from '../packages/api/src/streaming.ts';
import { parseDictationServerEvent } from '../packages/api/src/dictation.ts';
import {
	serverEventSchema,
	type ServerEvent,
} from '../packages/sdk/src/events/protocol.ts';
import {
	encodeSessionStreamEvent,
	encodeClientStreamEvent,
} from '../packages/server/src/events/stream-encoding.ts';
import {
	getProjectReplay,
	recordProjectClientEvent,
	recordProjectSessionEvent,
} from '../packages/server/src/events/project-replay.ts';
import {
	encodeSSEEvent,
	SSE_MAX_EVENT_BYTES,
} from '../packages/server/src/events/sse.ts';
import {
	publish,
	subscribeGlobalSessionEvents,
	subscribeScopedSessionEvents,
} from '../packages/server/src/events/bus.ts';

function frames(bytes: Uint8Array): SSEEvent[] {
	const events: SSEEvent[] = [];
	const decoder = createSSEDecoder((event) => events.push(event));
	// Exercise UTF-8 and SSE framing with actual serializer bytes split everywhere.
	for (const byte of bytes) decoder.feed(new Uint8Array([byte]));
	decoder.flush();
	return events;
}

const toolEvent: ServerEvent<'tool.call'> = {
	type: 'tool.call',
	sessionId: 'session-1',
	projectRoot: '/wire-contract',
	payload: {
		name: 'shell',
		callId: 'call-1',
		messageId: 'message-1',
		args: { command: 'echo hello' },
	},
};

describe('route serializer bytes to canonical API events', () => {
	test('session payload-only frames decode with the known session id', () => {
		const [frame] = frames(encodeSessionStreamEvent(toolEvent));
		expect(JSON.parse(frame.data)).toEqual(toolEvent.payload);
		const decoded = parseServerEvent(frame, toolEvent.sessionId);
		expect(decoded).toEqual({
			type: toolEvent.type,
			sessionId: toolEvent.sessionId,
			payload: toolEvent.payload,
		});
		if (decoded?.type === 'tool.call') {
			const callId: string = decoded.payload.callId;
			expect(callId).toBe('call-1');
		}
		expect(parseServerEvent(frame)).toBeNull();
	});

	test('client route payload-only bytes decode reference preparation and heartbeat', () => {
		const reference: Extract<ClientEvent, { type: 'reference.preparation' }> = {
			type: 'reference.preparation',
			payload: {
				name: 'source',
				url: 'https://example.test/source',
				projectRoot: '/wire-contract',
				status: 'available',
				output: ['ready'],
			},
		};
		const frame = frames(encodeClientStreamEvent(reference))[0];
		expect(parseClientEvent(frame)).toEqual(reference);
		expect(decodeSSEEvent(frame)).toEqual(reference);
		const heartbeat = {
			type: 'heartbeat',
			payload: { createdAt: '2026-10-12' },
		} as const;
		expect(
			decodeSSEEvent(frames(encodeClientStreamEvent(heartbeat))[0]),
		).toEqual(heartbeat);
	});

	test('project replay and live records decode with type and legacy envelopes without type', () => {
		const record = recordProjectSessionEvent(toolEvent);
		const [frame] = frames(record.chunk);
		expect(frame.id).toBe(record.id);
		expect(decodeSSEEvent(frame)).toEqual(toolEvent);
		const legacy = JSON.parse(frame.data);
		delete legacy.type;
		expect(decodeSSEEvent({ ...frame, data: JSON.stringify(legacy) })).toEqual(
			toolEvent,
		);
		const notification = {
			type: 'notification',
			payload: {
				id: 'n-1',
				level: 'info',
				title: 'Hello',
				createdAt: '2026-10-12',
				projectRoot: '/wire-contract',
			},
		} as const;
		expect(
			decodeSSEEvent(frames(recordProjectClientEvent(notification).chunk)[0]),
		).toEqual(notification);
		const replay = getProjectReplay(
			['/wire-contract'],
			String(Number(record.id) - 1),
		);
		expect(replay.records.some((entry) => entry.id === record.id)).toBe(true);
	});

	test('replay-missed control bytes decode explicitly', () => {
		const replay = getProjectReplay(['/wire-contract'], 'invalid');
		expect(replay.missed).toBe(true);
		const [frame] = frames(
			encodeSSEEvent('stream.replay.missed', {
				payload: { lastEventId: 'invalid' },
			}),
		);
		expect(decodeSSEEvent(frame)).toEqual({
			type: 'stream.replay.missed',
			payload: { lastEventId: 'invalid' },
		});
	});

	test('oversized session and project bytes decode as truncation, never as a fabricated complete event', () => {
		const oversized: ServerEvent<'tool.result'> = {
			type: 'tool.result',
			sessionId: 'session-1',
			payload: {
				name: 'shell',
				messageId: 'message-1',
				result: 'x'.repeat(SSE_MAX_EVENT_BYTES + 1),
			},
		};
		for (const bytes of [
			encodeSessionStreamEvent(oversized),
			recordProjectSessionEvent(oversized).chunk,
		]) {
			expect(bytes.byteLength).toBeLessThan(SSE_MAX_EVENT_BYTES);
			const event = decodeSSEEvent(frames(bytes)[0], 'session-1');
			expect(event?.type).toBe('stream.payload.truncated');
			if (event?.type === 'stream.payload.truncated') {
				expect(event.eventType).toBe('tool.result');
				expect(event.payload.streamPayloadTruncated).toBe(true);
			}
		}
	});
});

test('nested shell snapshots and optional payload fields are validated', () => {
	const base = {
		type: 'shell.job.updated',
		sessionId: 's',
		payload: { job: {} },
	};
	expect(serverEventSchema.safeParse(base).success).toBe(false);
	const job = {
		id: 'j',
		sessionId: 's',
		messageId: 'm',
		command: 'pwd',
		cwd: '/',
		status: 'running',
		detached: true,
		output: '',
		exitCode: null,
		result: null,
		reported: false,
		createdAt: 1,
		updatedAt: 1,
		completedAt: null,
	};
	expect(
		serverEventSchema.safeParse({ ...base, payload: { job } }).success,
	).toBe(true);
	expect(
		serverEventSchema.safeParse({
			...base,
			payload: { job: { ...job, exitCode: '0' } },
		}).success,
	).toBe(false);
	expect(
		serverEventSchema.safeParse({
			...toolEvent,
			payload: { ...toolEvent.payload, argsTruncated: 'yes' },
		}).success,
	).toBe(false);
});

test('shared decoder handles CRLF, multiline JSON, UTF-8 and ignores incomplete frames', () => {
	const bytes = new TextEncoder().encode(
		': hb\r\nid: 9\r\nevent: message.part.delta\r\ndata: {"messageId":"m","partId":"p",\r\ndata: "delta":"caf\u00e9"}\r\n\r\nevent: error\r\ndata: {',
	);
	const events = frames(bytes);
	expect(events).toHaveLength(1);
	const decoded = decodeSSEEvent(events[0], 's');
	expect(decoded?.type).toBe('message.part.delta');
	if (decoded?.type === 'message.part.delta')
		expect(decoded.payload.delta).toBe('caf\u00e9');
});

test('response consumer cancels and releases its reader when callbacks throw or abort', async () => {
	let cancelled = 0;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encodeSessionStreamEvent(toolEvent));
		},
		cancel() {
			cancelled += 1;
		},
	});
	await expect(
		consumeSSEResponse(new Response(body), {
			onEvent() {
				throw new Error('callback');
			},
		}),
	).rejects.toThrow('callback');
	expect(cancelled).toBe(1);
	expect(body.locked).toBe(false);
	const abort = new AbortController();
	const pendingBody = new ReadableStream<Uint8Array>({
		cancel() {
			cancelled += 1;
		},
	});
	const pending = consumeSSEResponse(new Response(pendingBody), {
		signal: abort.signal,
		onEvent() {},
	});
	abort.abort();
	await pending;
	expect(cancelled).toBe(2);
	expect(pendingBody.locked).toBe(false);
});

test('explicit global and scoped observers do not cross project boundaries accidentally', () => {
	const scoped: DecodedSSEEvent[] = [];
	const global: DecodedSSEEvent[] = [];
	const stopScoped = subscribeScopedSessionEvents(
		'session-1',
		(event) => scoped.push(event),
		'/wire-contract',
	);
	const stopGlobal = subscribeGlobalSessionEvents('session-1', (event) =>
		global.push(event),
	);
	try {
		publish(toolEvent);
		publish({ ...toolEvent, projectRoot: '/other-project' });
		expect(scoped).toHaveLength(1);
		expect(global).toHaveLength(2);
	} finally {
		stopScoped();
		stopGlobal();
	}
});

test('API dictation parser rejects malformed variants used by voice input', () => {
	expect(
		parseDictationServerEvent('{"type":"ready","sessionId":"s","model":"m"}'),
	).toBeNull();
	expect(
		parseDictationServerEvent(
			'{"type":"error","code":"invented","message":"oops"}',
		),
	).toBeNull();
	expect(
		parseDictationServerEvent(
			'{"type":"final","text":"hello","language":"en","model":"m","durationMs":100}',
		),
	).toEqual({
		type: 'final',
		text: 'hello',
		language: 'en',
		model: 'm',
		durationMs: 100,
	});
});
