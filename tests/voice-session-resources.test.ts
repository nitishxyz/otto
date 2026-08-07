import { describe, expect, test } from 'bun:test';
import {
	disposeVoiceSessionResources,
	type AudioContextLike,
	type MediaStreamLike,
	type ScriptProcessorLike,
} from '../packages/web-sdk/src/lib/voice-session-resources';

function fakeContext(state = 'running') {
	let closed = false;
	const context = {
		get state() {
			return closed ? 'closed' : state;
		},
		close: async () => {
			closed = true;
		},
	} satisfies AudioContextLike;
	return {
		context,
		get closed() {
			return closed;
		},
	};
}

function fakeStream() {
	const stopped: number[] = [];
	const stream: MediaStreamLike = {
		getTracks: () => [
			{ stop: () => stopped.push(1) },
			{ stop: () => stopped.push(2) },
		],
	};
	return { stream, stopped };
}

function fakeProcessor() {
	const calls: string[] = [];
	const processor = {
		onaudioprocess: () => {},
		disconnect: () => calls.push('disconnect'),
	} as unknown as ScriptProcessorLike;
	return { processor, calls };
}

describe('voice session resource disposal', () => {
	test('closes the audio context, stops tracks, and detaches nodes', async () => {
		const ctx = fakeContext();
		const { stream, stopped } = fakeStream();
		const { processor, calls } = fakeProcessor();
		const sourceCalls: string[] = [];

		disposeVoiceSessionResources({
			processor,
			source: { disconnect: () => sourceCalls.push('disconnect') },
			stream,
			context: ctx.context,
		});
		await Promise.resolve();

		expect(processor.onaudioprocess).toBeNull();
		expect(calls).toEqual(['disconnect']);
		expect(sourceCalls).toEqual(['disconnect']);
		expect(stopped).toEqual([1, 2]);
		expect(ctx.closed).toBe(true);
	});

	test('a partially built graph still releases the audio context', async () => {
		// getUserMedia resolved and the context was created, but the processor and
		// source were never wired before the run was aborted.
		const ctx = fakeContext();
		const { stream, stopped } = fakeStream();

		disposeVoiceSessionResources({ stream, context: ctx.context });
		await Promise.resolve();

		expect(stopped).toEqual([1, 2]);
		expect(ctx.closed).toBe(true);
	});

	test('a throwing node never strands the audio context', async () => {
		const ctx = fakeContext();
		const throwingProcessor = {
			onaudioprocess: () => {},
			disconnect: () => {
				throw new Error('already disconnected');
			},
		} as unknown as ScriptProcessorLike;

		disposeVoiceSessionResources({
			processor: throwingProcessor,
			source: {
				disconnect: () => {
					throw new Error('detached');
				},
			},
			stream: {
				getTracks: () => {
					throw new Error('ended');
				},
			},
			context: ctx.context,
		});
		await Promise.resolve();

		expect(ctx.closed).toBe(true);
	});

	test('an already closed context is not closed twice', () => {
		let closeCalls = 0;
		disposeVoiceSessionResources({
			context: {
				state: 'closed',
				close: async () => {
					closeCalls += 1;
				},
			},
		});
		expect(closeCalls).toBe(0);
	});

	test('an empty resource set is a no-op', () => {
		expect(() => disposeVoiceSessionResources({})).not.toThrow();
	});
});

describe('voice input lifecycle wiring', () => {
	test('cleanup no longer re-arms an in-flight start', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/hooks/useVoiceInput.ts',
		).text();
		const cleanupStart = source.indexOf('const cleanup = useCallback(');
		const cleanupBody = source.slice(cleanupStart, cleanupStart + 900);
		// Resetting the flag inside cleanup let an awaiting start() resume and
		// build an AudioContext that nothing owned.
		expect(cleanupBody).not.toContain('stoppingRef.current = false');
	});

	test('every post-creation abort path disposes instead of returning bare', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/hooks/useVoiceInput.ts',
		).text();
		const startIndex = source.indexOf('const start = useCallback(');
		const startBody = source.slice(startIndex);
		expect(startBody).not.toContain('if (stoppingRef.current) return;');
		expect(startBody).toContain(
			'const generation = ++startGenerationRef.current;',
		);
		const abortGuards = startBody.match(
			/if \(isStale\(\)\) \{\n\t{3}\t?abandon\(\);/g,
		);
		expect(abortGuards?.length ?? 0).toBeGreaterThanOrEqual(4);
	});

	test('unmount latches stopping and invalidates the generation', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/hooks/useVoiceInput.ts',
		).text();
		expect(source).toContain(
			'stoppingRef.current = true;\n\t\t\tstartGenerationRef.current += 1;',
		);
	});

	test('a superseded run does not run the shared cleanup on error', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/hooks/useVoiceInput.ts',
		).text();
		expect(source).toContain(
			'if (startGenerationRef.current !== generation) {',
		);
	});
});
