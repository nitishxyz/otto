import { describe, expect, test } from 'bun:test';
import { consumeSSE, createSSEStream } from '../src/streaming.ts';

function chunkedResponse(chunks: Uint8Array[]): Response {
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		}),
		{ headers: { 'Content-Type': 'text/event-stream' } },
	);
}

describe('SSE consumer', () => {
	test('selects GET or POST from explicit transport options', async () => {
		const methods: string[] = [];
		const fetchImpl: typeof fetch = async (_input, init) => {
			methods.push(init?.method ?? 'GET');
			return new Response('');
		};
		const base = {
			baseUrl: 'https://remote.example.com',
			sessionId: 'session-1',
			fetch: fetchImpl,
			onEvent: () => {},
		};

		await createSSEStream(base);
		await createSSEStream({ ...base, transportMode: 'tunnel' });
		await createSSEStream({
			...base,
			transportMode: 'tunnel',
			method: 'GET',
		});

		expect(methods).toEqual(['GET', 'POST', 'GET']);
	});

	test('parses chunk boundaries, multiline data, empty data, and decoder flush', async () => {
		const bytes = new TextEncoder().encode(
			'event: multi\ndata: first\ndata: second\n\ndata:\n\ndata: café\n\n',
		);
		const chunks = [
			bytes.slice(0, 8),
			bytes.slice(8, 31),
			bytes.slice(31, bytes.length - 1),
			bytes.slice(bytes.length - 1),
		];
		const events: Array<{ event?: string; data: string }> = [];

		await consumeSSE({
			url: 'http://example.test/events',
			fetch: async () => chunkedResponse(chunks),
			onEvent: (event) => events.push(event),
		});

		expect(events).toEqual([
			{ event: 'multi', data: 'first\nsecond', id: undefined },
			{ event: undefined, data: '', id: undefined },
			{ event: undefined, data: 'café', id: undefined },
		]);
	});

	test('rejects non-success responses and missing bodies', async () => {
		expect(
			consumeSSE({
				url: 'http://example.test/events',
				fetch: async () => new Response('no', { status: 503 }),
				onEvent: () => {},
			}),
		).rejects.toThrow('503');
		expect(
			consumeSSE({
				url: 'http://example.test/events',
				fetch: async () => ({ ok: true, body: null }) as Response,
				onEvent: () => {},
			}),
		).rejects.toThrow('has no body');
	});

	test('propagates read failures and closes aborted callback streams once', async () => {
		const failure = new Error('read failed');
		expect(
			consumeSSE({
				url: 'http://example.test/events',
				fetch: async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.error(failure);
							},
						}),
					),
				onEvent: () => {},
			}),
		).rejects.toBe(failure);

		const abort = new AbortController();
		let closes = 0;
		const streaming = createSSEStream(
			{
				baseUrl: 'http://example.test',
				sessionId: 'session-1',
				fetch: async (_input, init) =>
					new Response(
						new ReadableStream({
							start(controller) {
								init?.signal?.addEventListener('abort', () =>
									controller.error(init.signal?.reason),
								);
							},
						}),
					),
				onEvent: () => {},
				onClose: () => closes++,
			},
			abort.signal,
		);
		abort.abort();
		await streaming;
		expect(closes).toBe(1);
	});
});
