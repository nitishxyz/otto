import { describe, expect, test } from 'bun:test';
import { messageParts } from '@ottocode/database/schema';
import { subscribe } from '../packages/server/src/events/bus.ts';
import type { OttoEvent } from '../packages/server/src/events/types.ts';
import { consumeRunnerStreamParts } from '../packages/server/src/runtime/agent/runner/runner-stream-parts.ts';
import { createOauthCodexTextGuardState } from '../packages/server/src/runtime/stream/text-guard.ts';
import type { RunOpts } from '../packages/server/src/runtime/session/queue.ts';
import type { RunnerTextState } from '../packages/server/src/runtime/agent/runner/runner-text.ts';
import type { ToolAdapterContext } from '../packages/server/src/tools/adapter.ts';

function createFakeDb() {
	return {
		insert(table: unknown) {
			expect(table).toBe(messageParts);
			return { values: async () => {} };
		},
		update(table: unknown) {
			expect(table).toBe(messageParts);
			return { set: () => ({ where: async () => {} }) };
		},
		delete(table: unknown) {
			expect(table).toBe(messageParts);
			return { where: async () => {} };
		},
	};
}

async function* streamParts(parts: unknown[]) {
	for (const part of parts) yield part;
}

function hangingStream(onReturn: () => void): AsyncIterable<unknown> {
	return {
		[Symbol.asyncIterator]() {
			return {
				next: () => new Promise<IteratorResult<unknown>>(() => {}),
				return: async () => {
					onReturn();
					return { done: true, value: undefined };
				},
			};
		},
	};
}

function createConsumeArgs(parts: unknown[]) {
	const opts: RunOpts = {
		sessionId: crypto.randomUUID(),
		assistantMessageId: crypto.randomUUID(),
		agent: 'build',
		provider: 'anthropic',
		model: 'claude-sonnet-4-5-20250929',
		projectRoot: process.cwd(),
	};
	const textState: RunnerTextState = {
		currentPartId: null,
		accumulated: '',
		latestAssistantText: '',
		lastTextDeltaStepIndex: null,
		firstPublishedDeltaSeen: false,
	};
	const sharedCtx: ToolAdapterContext = {
		sessionId: opts.sessionId,
		messageId: opts.assistantMessageId,
		assistantPartId: crypto.randomUUID(),
		db: createFakeDb() as never,
		agent: opts.agent,
		provider: opts.provider,
		model: opts.model,
		projectRoot: opts.projectRoot,
		nextIndex: () => 0,
	};

	return {
		fullStream: streamParts(parts),
		opts,
		db: createFakeDb() as never,
		sharedCtx,
		textState,
		toolObserver: {
			toolActivityObserved: false,
			trailingAssistantTextAfterTool: false,
			endedWithToolActivity: false,
		},
		reasoningStates: new Map(),
		oauthTextGuard: null,
		getStepIndex: () => 0,
		firstToolSeen: () => false,
		logFirstOutputLatency: () => {},
		runStartedAt: Date.now(),
		queueWaitMs: 0,
		setupMs: 0,
		dump: null,
	};
}

describe('consumeRunnerStreamParts', () => {
	test('accepts AI SDK delta-shaped reasoning chunks', async () => {
		const args = createConsumeArgs([
			{ type: 'reasoning-start', id: 'reasoning-1' },
			{ type: 'reasoning-delta', id: 'reasoning-1', delta: 'thinking...' },
			{ type: 'reasoning-end', id: 'reasoning-1' },
		]);
		const events: OttoEvent[] = [];
		const unsubscribe = subscribe(args.opts.sessionId, (event) => {
			events.push(event);
		});

		try {
			await consumeRunnerStreamParts(args);
		} finally {
			unsubscribe();
		}

		expect(events).toContainEqual(
			expect.objectContaining({
				type: 'reasoning.delta',
				payload: expect.objectContaining({ delta: 'thinking...' }),
			}),
		);
	});

	test('accepts AI SDK delta-shaped text chunks', async () => {
		const args = createConsumeArgs([
			{ type: 'text-delta', id: 'text-1', delta: 'hello' },
		]);
		const events: OttoEvent[] = [];
		const unsubscribe = subscribe(args.opts.sessionId, (event) => {
			events.push(event);
		});

		try {
			await consumeRunnerStreamParts(args);
		} finally {
			unsubscribe();
		}

		expect(events).toContainEqual(
			expect.objectContaining({
				type: 'message.part.delta',
				payload: expect.objectContaining({ delta: 'hello' }),
			}),
		);
	});

	test('aborts while waiting for the first stream part', async () => {
		const controller = new AbortController();
		let returned = false;
		const args = createConsumeArgs([]);
		args.opts.abortSignal = controller.signal;
		args.fullStream = hangingStream(() => {
			returned = true;
		});

		const promise = consumeRunnerStreamParts(args);
		await Promise.resolve();
		controller.abort(new Error('stop now'));

		await expect(promise).rejects.toThrow('stop now');
		expect(returned).toBe(true);
	});

	test('oauth text guard recovers after tool boundary (post-tool prose is published)', async () => {
		const args = createConsumeArgs([
			{
				type: 'text-delta',
				id: 'text-1',
				delta:
					'Checking now. assistant to=functions.shell commentary {"cmd":"ls"}',
			},
			{ type: 'tool-call', toolCallId: 'call-1', toolName: 'shell' },
			{ type: 'tool-result', toolCallId: 'call-1', toolName: 'shell' },
			{ type: 'text-delta', id: 'text-2', delta: 'The tests all pass.' },
		]);
		args.oauthTextGuard = createOauthCodexTextGuardState() as never;
		const events: OttoEvent[] = [];
		const unsubscribe = subscribe(args.opts.sessionId, (event) => {
			events.push(event);
		});

		try {
			await consumeRunnerStreamParts(args);
		} finally {
			unsubscribe();
		}

		const deltas = events
			.filter((event) => event.type === 'message.part.delta')
			.map((event) => (event.payload as { delta?: string }).delta);
		expect(deltas).toContain('Checking now.');
		expect(deltas).toContain('The tests all pass.');
		expect(deltas.join('')).not.toContain('assistant to=');
	});
});
