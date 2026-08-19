import { describe, expect, test } from 'bun:test';
import {
	createSSEResponse,
	encodeSSEComment,
	encodeSSEEvent,
	type SSEStreamControls,
} from '../packages/server/src/events/sse.ts';

const decoder = new TextDecoder();

function getReader(
	response: Response,
): ReadableStreamDefaultReader<Uint8Array> {
	if (!response.body) throw new Error('Expected response body');
	return response.body.getReader();
}

async function readChunk(
	reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
	const result = await reader.read();
	expect(result.done).toBe(false);
	return decoder.decode(result.value);
}

describe('server SSE lifecycle', () => {
	test('uses standard headers and cleans up exactly once on abort and cancel', async () => {
		const abort = new AbortController();
		let cleanups = 0;
		const response = createSSEResponse({
			signal: abort.signal,
			initialChunk: encodeSSEComment('connected'),
			start({ onCleanup }) {
				onCleanup(() => cleanups++);
			},
		});
		expect(response.headers.get('content-type')).toBe('text/event-stream');
		expect(response.headers.get('cache-control')).toBe(
			'no-cache, no-transform',
		);
		expect(response.headers.get('x-accel-buffering')).toBe('no');

		const reader = getReader(response);
		expect(await readChunk(reader)).toBe(': connected\n\n');
		abort.abort();
		await reader.cancel();
		expect(cleanups).toBe(1);
	});

	test('supports comment and typed-event heartbeat variants', async () => {
		const commentResponse = createSSEResponse({
			heartbeat: {
				intervalMs: 1,
				createChunk: () => encodeSSEComment('hb'),
			},
		});
		const commentReader = getReader(commentResponse);
		expect(await readChunk(commentReader)).toBe(': hb\n\n');
		await commentReader.cancel();

		const eventResponse = createSSEResponse({
			heartbeat: {
				intervalMs: 1,
				createChunk: () => encodeSSEEvent('heartbeat', { alive: true }),
			},
		});
		const eventReader = getReader(eventResponse);
		expect(await readChunk(eventReader)).toBe(
			'event: heartbeat\ndata: {"alive":true}\n\n',
		);
		await eventReader.cancel();
	});

	test('closes backpressured streams and rejects sends after cancellation', async () => {
		let controls: SSEStreamControls | undefined;
		let cleanups = 0;
		let backpressure = 0;
		const response = createSSEResponse({
			initialChunk: encodeSSEComment('too large'),
			strategy: new ByteLengthQueuingStrategy({ highWaterMark: 1 }),
			onBackpressure: () => backpressure++,
			start(value) {
				controls = value;
				value.onCleanup(() => cleanups++);
			},
		});
		const reader = getReader(response);
		expect(await readChunk(reader)).toBe(': too large\n\n');
		expect((await reader.read()).done).toBe(true);
		expect(backpressure).toBe(1);
		expect(cleanups).toBe(1);
		expect(controls?.send(encodeSSEComment('late'))).toBe(false);
		await reader.cancel();
		expect(cleanups).toBe(1);
	});
});
