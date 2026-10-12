import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { ProviderStreamIdleTimeoutError } from '@ottocode/sdk';
import { NoOutputGeneratedError } from 'ai';
import { eq } from 'drizzle-orm';
import { subscribeClientEvents } from '../packages/server/src/events/bus.ts';
import type { ClientEvent } from '../packages/server/src/events/types.ts';
import { consumeRunnerStreamParts } from '../packages/server/src/runtime/agent/runner/runner-stream-parts.ts';
import {
	claimPendingMessage,
	scheduleContinuation,
} from '../packages/server/src/runtime/agent/turn/continuation.ts';
import { finalizeTurn } from '../packages/server/src/runtime/agent/turn/finalize.ts';
import {
	completePendingAssistantMessage,
	createTurnTerminal,
	selectPrimaryError,
} from '../packages/server/src/runtime/agent/turn/terminal.ts';
import {
	cleanupSession,
	dequeueJob,
	getRunnerState,
	type RunOpts,
} from '../packages/server/src/runtime/session/queue.ts';

let projectRoot = '';

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-harness-terminal-'));
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

async function setupRun(signal?: AbortSignal) {
	const db = await getDb(projectRoot);
	const sessionId = crypto.randomUUID();
	const assistantMessageId = crypto.randomUUID();
	const now = Date.now();
	await db.insert(sessions).values({
		id: sessionId,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		projectPath: projectRoot,
		createdAt: now,
	});
	await db.insert(messages).values({
		id: assistantMessageId,
		sessionId,
		role: 'assistant',
		status: 'pending',
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		createdAt: now,
	});
	const opts: RunOpts = {
		sessionId,
		assistantMessageId,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		projectRoot,
		abortSignal: signal,
	};
	return { db, opts };
}

function fakeHandlers() {
	const calls: string[] = [];
	return {
		calls,
		handlers: {
			persistError: async () => {
				calls.push('error');
			},
			persistAbort: async () => {
				calls.push('abort');
			},
			onStepFinish: async () => {},
			flushTextPart: async () => {},
			triggerTitleGenerationWhenReady: () => {},
		},
	};
}

function finalizeArgs(
	base: Awaited<ReturnType<typeof setupRun>>,
	terminal: ReturnType<typeof createTurnTerminal>,
	handlers: ReturnType<typeof fakeHandlers>['handlers'],
) {
	return {
		opts: base.opts,
		db: base.db,
		terminal,
		handlers: handlers as never,
		result: undefined,
		runSessionLoop: async () => {},
		dump: null,
		textState: {
			currentPartId: null,
			accumulated: '',
			latestAssistantText: '',
			lastTextDeltaStepIndex: null,
			firstPublishedDeltaSeen: false,
		},
		getStepIndex: () => 0,
		firstToolSeen: () => false,
		toolObserver: {
			toolActivityObserved: false,
			trailingAssistantTextAfterTool: false,
			endedWithToolActivity: false,
		},
		autoCompactThresholdTokens: null,
		turnStoppedForAutoCompact: () => false,
	};
}

async function readMessage(db: Awaited<ReturnType<typeof getDb>>, id: string) {
	const [row] = await db.select().from(messages).where(eq(messages.id, id));
	return row;
}

function captureNotifications() {
	const events: ClientEvent[] = [];
	const unsubscribe = subscribeClientEvents((event) => {
		events.push(event);
	});
	return { events, unsubscribe };
}

describe('turn terminal ownership', () => {
	test('NoOutputGeneratedError never masks the original idle timeout', () => {
		const idle = new ProviderStreamIdleTimeoutError(1000);
		const wrapper = new NoOutputGeneratedError({ message: 'no output' });
		expect(selectPrimaryError([wrapper, idle])).toBe(idle);
		expect(selectPrimaryError([idle, wrapper])).toBe(idle);
		const terminal = createTurnTerminal();
		terminal.recordError({ error: idle });
		terminal.recordError(wrapper);
		expect(terminal.primaryError()).toBe(idle);
	});

	test('completion never overwrites an error written by another owner', async () => {
		const run = await setupRun();
		await run.db
			.update(messages)
			.set({ status: 'error', error: 'boom', finishReason: 'error' })
			.where(eq(messages.id, run.opts.assistantMessageId));
		const completed = await completePendingAssistantMessage({
			db: run.db,
			opts: run.opts,
			fin: { finishReason: 'stop' },
		});
		const row = await readMessage(run.db, run.opts.assistantMessageId);
		expect(completed).toBe(false);
		expect(row.status).toBe('error');
		expect(row.finishReason).toBe('error');
	});

	test('empty finish is marked as error without a success notification', async () => {
		const run = await setupRun();
		await run.db.insert(messageParts).values({
			id: crypto.randomUUID(),
			messageId: run.opts.assistantMessageId,
			index: 0,
			type: 'tool_result',
			content: JSON.stringify({
				name: 'memory_context',
				synthetic: true,
				result: {},
			}),
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			toolName: 'memory_context',
			startedAt: Date.now(),
		});
		const terminal = createTurnTerminal();
		terminal.recordFinish({ finishReason: 'stop' });
		const { handlers } = fakeHandlers();
		const notifications = captureNotifications();
		try {
			await finalizeTurn(finalizeArgs(run, terminal, handlers));
		} finally {
			notifications.unsubscribe();
		}
		const row = await readMessage(run.db, run.opts.assistantMessageId);
		expect(row.status).toBe('error');
		expect(row.errorType).toBe('empty_response');
		const successes = notifications.events.filter(
			(event) =>
				event.type === 'notification' &&
				(event.payload as { level?: string }).level === 'success',
		);
		expect(successes).toHaveLength(0);
		expect(terminal.outcome()).toBe('empty');
	});

	test('successful finish completes once and later finalize calls are inert', async () => {
		const run = await setupRun();
		await run.db.insert(messageParts).values({
			id: crypto.randomUUID(),
			messageId: run.opts.assistantMessageId,
			index: 0,
			type: 'text',
			content: JSON.stringify({ text: 'done' }),
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			startedAt: Date.now(),
		});
		const terminal = createTurnTerminal();
		terminal.recordFinish({ finishReason: 'stop' });
		const { handlers, calls } = fakeHandlers();
		await finalizeTurn(finalizeArgs(run, terminal, handlers));
		terminal.recordError(new Error('late error'));
		await finalizeTurn(finalizeArgs(run, terminal, handlers));
		const row = await readMessage(run.db, run.opts.assistantMessageId);
		expect(row.status).toBe('complete');
		expect(row.finishReason).toBe('stop');
		expect(calls).toEqual([]);
	});

	test('error with an earlier finish fact is persisted as failure, not success', async () => {
		const run = await setupRun();
		const terminal = createTurnTerminal();
		terminal.recordFinish({ finishReason: 'stop' });
		terminal.recordError(new Error('stream broke'));
		const { handlers, calls } = fakeHandlers();
		await finalizeTurn(finalizeArgs(run, terminal, handlers));
		expect(calls).toEqual(['error']);
		const row = await readMessage(run.db, run.opts.assistantMessageId);
		expect(row.status).toBe('pending');
	});

	test('preempted runs are finalized by the abort owner with reason preserved', async () => {
		const controller = new AbortController();
		controller.abort({ type: 'send-now-preempt', nextMessageId: 'next' });
		const run = await setupRun(controller.signal);
		const terminal = createTurnTerminal();
		terminal.recordError(new Error('aborted'));
		const { handlers, calls } = fakeHandlers();
		await finalizeTurn(finalizeArgs(run, terminal, handlers));
		expect(calls).toEqual(['abort']);
		expect(terminal.outcome()).toBe('aborted');
	});

	test('idle timeout behind NoOutputGeneratedError is retried before any failure write', async () => {
		const run = await setupRun();
		const terminal = createTurnTerminal();
		terminal.recordError(new ProviderStreamIdleTimeoutError(1000));
		terminal.recordError(new NoOutputGeneratedError({ message: 'no output' }));
		const { handlers, calls } = fakeHandlers();
		await finalizeTurn(finalizeArgs(run, terminal, handlers));
		expect(calls).toEqual([]);
		expect(terminal.outcome()).toBe('continued');
		const row = await readMessage(run.db, run.opts.assistantMessageId);
		expect(row.status).toBe('complete');
		expect(row.finishReason).toBe('stream-idle-retry');
		const queue = getRunnerState(run.opts.sessionId, projectRoot)?.queue ?? [];
		expect(queue).toHaveLength(1);
		expect(queue[0]?.streamIdleRetryCount).toBe(1);
		dequeueJob(run.opts.sessionId, projectRoot);
		cleanupSession(run.opts.sessionId, projectRoot);
	});
});

describe('continuation scheduler', () => {
	test('recovery claim is atomic', async () => {
		const run = await setupRun();
		const first = claimPendingMessage(run.db, run.opts.assistantMessageId, {
			status: 'complete',
		});
		const second = claimPendingMessage(run.db, run.opts.assistantMessageId, {
			status: 'complete',
		});
		expect([await first, await second].sort()).toEqual([false, true]);
	});

	test('cancelled runs never enqueue continuations', async () => {
		const controller = new AbortController();
		const run = await setupRun(controller.signal);
		controller.abort();
		const scheduled = await scheduleContinuation({
			db: run.db,
			opts: run.opts,
			kind: 'max-output',
			counters: { continuationCount: 1 },
			runSessionLoop: async () => {},
		});
		expect(scheduled).toBeNull();
		expect(getRunnerState(run.opts.sessionId, projectRoot)).toBeUndefined();
		const rows = await run.db
			.select()
			.from(messages)
			.where(eq(messages.sessionId, run.opts.sessionId));
		expect(rows).toHaveLength(1);
	});

	test('combined budget applies across continuation kinds', async () => {
		const run = await setupRun();
		const scheduled = await scheduleContinuation({
			db: run.db,
			opts: {
				...run.opts,
				compactionRetries: 2,
				continuationCount: 1,
				streamIdleRetryCount: 1,
			},
			kind: 'stream-idle-retry',
			counters: { streamIdleRetryCount: 2 },
			runSessionLoop: async () => {},
		});
		expect(scheduled).toBeNull();
	});
});

describe('stream error chunks', () => {
	test('SDK error parts reach the terminal instead of being ignored', async () => {
		const run = await setupRun();
		const original = new ProviderStreamIdleTimeoutError(500);
		const seen: unknown[] = [];
		async function* parts() {
			yield { type: 'text-delta', id: 't', delta: '' };
			yield { type: 'error', error: original };
		}
		await consumeRunnerStreamParts({
			fullStream: parts(),
			opts: run.opts,
			db: run.db,
			sharedCtx: {
				sessionId: run.opts.sessionId,
				messageId: run.opts.assistantMessageId,
				assistantPartId: crypto.randomUUID(),
				db: run.db,
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5',
				projectRoot,
				nextIndex: () => 0,
			} as never,
			textState: {
				currentPartId: null,
				accumulated: '',
				latestAssistantText: '',
				lastTextDeltaStepIndex: null,
				firstPublishedDeltaSeen: false,
			},
			toolObserver: {
				toolActivityObserved: false,
				trailingAssistantTextAfterTool: false,
				endedWithToolActivity: false,
			},
			reasoningStates: new Map(),
			oauthTextGuard: null,
			getStepIndex: () => 0,
			firstToolSeen: () => true,
			logFirstOutputLatency: () => {},
			runStartedAt: 0,
			queueWaitMs: 0,
			setupMs: 0,
			dump: null,
			onStreamError: (error) => seen.push(error),
		});
		expect(seen).toEqual([original]);
	});
});
