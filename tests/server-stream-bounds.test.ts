import { describe, expect, test } from 'bun:test';
import { BoundedTerminalSseWriter } from '../packages/server/src/routes/terminals/service.ts';
import type { ToolAdapterContext } from '../packages/server/src/runtime/tools/context.ts';
import { createSecureShellExecutor } from '../packages/server/src/tools/adapter/secure-shell.ts';
import { consumeToolStream } from '../packages/server/src/tools/adapter/stream.ts';

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function mockContext(): ToolAdapterContext {
	return {
		sessionId: crypto.randomUUID(),
		messageId: crypto.randomUUID(),
		assistantPartId: crypto.randomUUID(),
		db: {} as ToolAdapterContext['db'],
		agent: 'build',
		provider: 'test',
		model: 'test',
		projectRoot: process.cwd(),
		nextIndex: () => 0,
	};
}

describe('bounded server streams', () => {
	test('serializes terminal writes and bounds pending entries', async () => {
		const gates: ReturnType<typeof deferred>[] = [];
		const written: string[] = [];
		let activeWrites = 0;
		let maxActiveWrites = 0;
		const writer = new BoundedTerminalSseWriter(
			async (data) => {
				activeWrites++;
				maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
				written.push(data);
				const gate = deferred();
				gates.push(gate);
				await gate.promise;
				activeWrites--;
			},
			() => {},
		);

		writer.enqueue('first');
		await Bun.sleep(0);
		for (let index = 0; index < 1_000; index++)
			writer.enqueue(`event-${index}`);
		const drained = writer.drain();
		while (gates.length > 0 || activeWrites > 0) {
			const gate = gates.shift();
			if (gate) gate.resolve();
			await Bun.sleep(0);
		}

		expect(await drained).toBe(true);
		expect(maxActiveWrites).toBe(1);
		expect(written.length).toBeLessThanOrEqual(65);
		expect(written.at(-1)).toBe('event-999');
	});

	test('stops a terminal writer after a write failure', async () => {
		const failure = deferred();
		const writer = new BoundedTerminalSseWriter(
			async () => {
				throw new Error('closed');
			},
			() => failure.resolve(),
		);
		writer.enqueue('event');

		await failure.promise;
		expect(writer.enqueue('later')).toBe(false);
		expect(await writer.drain()).toBe(false);
	});

	test('coalesces slow shell output and preserves the bounded final result', async () => {
		const executor = createSecureShellExecutor({ ctx: mockContext() });
		const iterator = executor({
			cmd: `bun -e "process.stdout.write('x'.repeat(500000))"`,
			cwd: process.cwd(),
			allowNonZeroExit: false,
			timeout: 10_000,
			envMode: 'minimal',
			outputMode: 'full',
			tailLines: 100,
			maxOutputBytes: 1_024,
			detached: false,
		})[Symbol.asyncIterator]();

		const chunks: unknown[] = [];
		const first = await iterator.next();
		if (!first.done) chunks.push(first.value);
		await Bun.sleep(100);
		for (;;) {
			const next = await iterator.next();
			if (next.done) break;
			chunks.push(next.value);
		}

		const outputChunks = chunks.filter(
			(chunk): chunk is { delta: string } =>
				!!chunk && typeof chunk === 'object' && 'delta' in chunk,
		);
		const finalChunk = chunks.at(-1) as {
			result: { stdout: string; ok: boolean };
		};
		expect(outputChunks.length).toBeLessThan(20);
		expect(
			outputChunks.every(
				(chunk) => Buffer.byteLength(chunk.delta) <= 64 * 1024,
			),
		).toBe(true);
		expect(finalChunk.result.ok).toBe(true);
		expect(Buffer.byteLength(finalChunk.result.stdout)).toBe(1_024);
	});

	test('consumeToolStream returns only the explicit result or last chunk', async () => {
		async function* withResult() {
			for (let index = 0; index < 10_000; index++) yield { index };
			yield { result: { ok: true } };
			yield { trailing: true };
		}
		async function* withoutResult() {
			yield { first: true };
			yield { last: true };
		}

		expect(
			await consumeToolStream(mockContext(), {
				stream: withResult(),
				name: 'test',
			}),
		).toEqual({ ok: true });
		expect(
			await consumeToolStream(mockContext(), {
				stream: withoutResult(),
				name: 'test',
			}),
		).toEqual({ last: true });
	});
});
