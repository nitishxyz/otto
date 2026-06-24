import { describe, expect, test } from 'bun:test';
import { messageParts } from '@ottocode/database/schema';
import { subscribe } from '../packages/server/src/events/bus.ts';
import type { OttoEvent } from '../packages/server/src/events/types.ts';
import { consumeRunnerStreamParts } from '../packages/server/src/runtime/agent/runner/runner-stream-parts.ts';
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
});
