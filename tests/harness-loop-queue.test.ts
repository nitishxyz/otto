import { describe, expect, test } from 'bun:test';
import { createSessionLoop } from '../packages/server/src/runtime/agent/runner.ts';
import {
	enqueueAssistantRun,
	getQueueState,
	getRunnerState,
	type RunOpts,
} from '../packages/server/src/runtime/session/queue.ts';

function job(
	sessionId: string,
	projectRoot: string,
	id = crypto.randomUUID(),
): Omit<RunOpts, 'abortSignal' | 'queuedAt'> {
	return {
		sessionId,
		assistantMessageId: id,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		projectRoot,
	};
}

async function microtasks(depth: number) {
	for (let i = 0; i < depth; i++) await Promise.resolve();
}

async function settle() {
	for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('session loop idle boundary', () => {
	for (let depth = 0; depth <= 8; depth++) {
		test(`a job enqueued ${depth} microtasks after the last job finishes is processed`, async () => {
			const sessionId = crypto.randomUUID();
			const projectRoot = `/tmp/harness-loop-${crypto.randomUUID()}`;
			const processed: string[] = [];
			const followUpId = crypto.randomUUID();
			let enqueuedFollowUp = false;
			const loop = createSessionLoop({
				execute: async (current) => {
					processed.push(current.assistantMessageId);
					if (enqueuedFollowUp) return;
					enqueuedFollowUp = true;
					void microtasks(depth).then(() =>
						enqueueAssistantRun(job(sessionId, projectRoot, followUpId), loop),
					);
				},
				onFailure: async () => {},
				onIdle: async () => {},
			});

			enqueueAssistantRun(job(sessionId, projectRoot), loop);
			await settle();

			expect(processed).toContain(followUpId);
			expect(processed).toHaveLength(2);
			expect(getRunnerState(sessionId, projectRoot)).toBeUndefined();
		});
	}

	test('runner state is keyed by project root and session id', async () => {
		const sessionId = crypto.randomUUID();
		const rootA = `/tmp/harness-loop-a-${crypto.randomUUID()}`;
		const rootB = `/tmp/harness-loop-b-${crypto.randomUUID()}`;
		const noop = async () => {};
		enqueueAssistantRun(job(sessionId, rootA), noop);
		enqueueAssistantRun(job(sessionId, rootB), noop);

		expect(getQueueState(sessionId, rootA)?.queuedMessages).toHaveLength(1);
		expect(getQueueState(sessionId, rootB)?.queuedMessages).toHaveLength(1);
		expect(getRunnerState(sessionId, rootA)).not.toBe(
			getRunnerState(sessionId, rootB),
		);

		const loop = createSessionLoop({
			execute: async () => {},
			onFailure: async () => {},
			onIdle: async () => {},
		});
		await loop(sessionId, rootA);
		await loop(sessionId, rootB);
		expect(getRunnerState(sessionId, rootA)).toBeUndefined();
		expect(getRunnerState(sessionId, rootB)).toBeUndefined();
	});

	test('a failing executor releases the runner and keeps draining', async () => {
		const sessionId = crypto.randomUUID();
		const projectRoot = `/tmp/harness-loop-${crypto.randomUUID()}`;
		const failures: string[] = [];
		const processed: string[] = [];
		const loop = createSessionLoop({
			execute: async (current) => {
				processed.push(current.assistantMessageId);
				throw new Error('boom');
			},
			onFailure: async (current) => {
				failures.push(current.assistantMessageId);
			},
			onIdle: async () => {},
		});
		const noop = async () => {};
		enqueueAssistantRun(job(sessionId, projectRoot), noop);
		enqueueAssistantRun(job(sessionId, projectRoot), noop);
		await loop(sessionId, projectRoot);

		expect(processed).toHaveLength(2);
		expect(failures).toEqual(processed);
		expect(getRunnerState(sessionId, projectRoot)).toBeUndefined();
	});
});
