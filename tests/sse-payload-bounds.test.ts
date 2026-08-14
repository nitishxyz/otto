import { describe, expect, test } from 'bun:test';
import {
	createSSEByteStrategy,
	encodeSSEEvent,
	SSE_MAX_EVENT_BYTES,
} from '../packages/server/src/events/sse.ts';
import { boundToolEventValue } from '../packages/server/src/events/tool-payload.ts';
import { subscribe } from '../packages/server/src/events/bus.ts';
import type { OttoEvent } from '../packages/server/src/events/types.ts';
import type { ToolAdapterContext } from '../packages/server/src/runtime/tools/context.ts';
import {
	publishToolCall,
	publishToolDelta,
	publishToolResult,
} from '../packages/server/src/tools/adapter/events.ts';

function context(sessionId: string): ToolAdapterContext {
	return {
		sessionId,
		messageId: `${sessionId}-message`,
		projectRoot: process.cwd(),
	} as ToolAdapterContext;
}

describe('bounded SSE payloads', () => {
	test('retains useful head and tail context from large tool values', () => {
		const content = `HEAD:${'a'.repeat(100_000)}:TAIL`;
		const bounded = boundToolEventValue({ path: 'src/large.ts', content });
		const value = bounded.value as {
			path: string;
			content: string;
		};

		expect(bounded.truncated).toBe(true);
		expect(bounded.originalBytes).toBeGreaterThan(100_000);
		expect(value.path).toBe('src/large.ts');
		expect(value.content.startsWith('HEAD:')).toBe(true);
		expect(value.content.endsWith(':TAIL')).toBe(true);
		expect(value.content).toContain('truncated for live stream');
		expect(value.content.length).toBeLessThan(25_000);
	});

	test('caps encoded SSE events and marks the payload as truncated', () => {
		const encoded = encodeSSEEvent('tool.result', {
			result: { output: 'x'.repeat(SSE_MAX_EVENT_BYTES * 2) },
		});
		const text = new TextDecoder().decode(encoded);

		expect(encoded.byteLength).toBeLessThan(SSE_MAX_EVENT_BYTES);
		expect(text).toContain('streamPayloadTruncated');
		expect(text).toContain('truncated for live stream');
	});

	test('keeps multibyte SSE events below the byte ceiling', () => {
		const encoded = encodeSSEEvent('tool.result', {
			result: { output: '🚀'.repeat(SSE_MAX_EVENT_BYTES) },
		});
		const text = new TextDecoder().decode(encoded);

		expect(encoded.byteLength).toBeLessThan(SSE_MAX_EVENT_BYTES);
		expect(text).toContain('streamPayloadTruncated');
	});

	test('uses byte length rather than chunk count for stream backpressure', () => {
		const desiredSizes: number[] = [];
		const stream = new ReadableStream<Uint8Array>(
			{
				start(controller) {
					controller.enqueue(new Uint8Array(700 * 1024));
					desiredSizes.push(controller.desiredSize ?? 0);
					controller.enqueue(new Uint8Array(400 * 1024));
					desiredSizes.push(controller.desiredSize ?? 0);
					controller.close();
				},
			},
			createSSEByteStrategy(),
		);
		void stream;

		expect(desiredSizes[0]).toBe(324 * 1024);
		expect(desiredSizes[1]).toBe(-76 * 1024);
	});

	test('bounds complete tool args and results while preserving metadata', () => {
		const sessionId = `tool-payload-${crypto.randomUUID()}`;
		const events: OttoEvent[] = [];
		const unsubscribe = subscribe(
			sessionId,
			(event) => events.push(event),
			process.cwd(),
		);
		const ctx = context(sessionId);
		const large = `HEAD:${'x'.repeat(100_000)}:TAIL`;

		try {
			publishToolCall(ctx, {
				name: 'write',
				input: { path: 'src/large.ts', content: large },
				callId: 'call-large',
			});
			publishToolResult(ctx, {
				name: 'write',
				callId: 'call-large',
				args: { path: 'src/large.ts', content: large },
				result: { ok: true, output: large, artifact: { patch: large } },
				artifact: { patch: large },
			});
		} finally {
			unsubscribe();
		}

		const call = events.find((event) => event.type === 'tool.call');
		const result = events.find((event) => event.type === 'tool.result');
		const callPayload = call?.payload as Record<string, unknown>;
		const resultPayload = result?.payload as Record<string, unknown>;
		const callArgs = callPayload.args as Record<string, unknown>;

		expect(callPayload.argsTruncated).toBe(true);
		expect(callArgs.path).toBe('src/large.ts');
		expect(String(callArgs.content)).toContain('truncated for live stream');
		expect(resultPayload.argsTruncated).toBe(true);
		expect(resultPayload.resultTruncated).toBe(true);
		expect(
			(resultPayload.result as Record<string, unknown>).artifact,
		).toBeUndefined();
		expect(resultPayload.artifactTruncated).toBe(true);
		expect(JSON.stringify(callPayload).length).toBeLessThan(70_000);
		expect(JSON.stringify(resultPayload).length).toBeLessThan(180_000);
	});

	test('caps cumulative tool input deltas and refreshes the final preview', () => {
		const sessionId = `tool-deltas-${crypto.randomUUID()}`;
		const events: OttoEvent[] = [];
		const unsubscribe = subscribe(
			sessionId,
			(event) => events.push(event),
			process.cwd(),
		);
		const ctx = context(sessionId);
		const delta = 'd'.repeat(24_000);

		try {
			for (let index = 0; index < 5; index++) {
				publishToolDelta(ctx, {
					name: 'write',
					channel: 'input',
					delta,
					callId: 'call-deltas',
				});
			}
			publishToolCall(ctx, {
				name: 'write',
				input: {
					path: 'src/large.ts',
					content: `HEAD:${'z'.repeat(100_000)}:TAIL`,
				},
				callId: 'call-deltas',
			});
		} finally {
			unsubscribe();
		}

		const deltas = events.filter((event) => event.type === 'tool.delta');
		const streamedChars = deltas.reduce((total, event) => {
			const value = (event.payload as Record<string, unknown>).delta;
			return total + (typeof value === 'string' ? value.length : 0);
		}, 0);
		const call = events.find((event) => event.type === 'tool.call');
		const args = (call?.payload as Record<string, unknown>).args as Record<
			string,
			unknown
		>;

		expect(streamedChars).toBe(48_000);
		expect(deltas.length).toBe(3);
		expect(
			deltas.some(
				(event) =>
					(event.payload as Record<string, unknown>).deltaTruncated === true,
			),
		).toBe(true);
		expect(String(args.content).startsWith('HEAD:')).toBe(true);
		expect(String(args.content).endsWith(':TAIL')).toBe(true);
	});
});
