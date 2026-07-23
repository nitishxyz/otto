import { describe, expect, it } from 'bun:test';
import { createApp } from '@ottocode/server';
import { subscribe } from '../packages/server/src/events/bus.ts';
import {
	abortAllActiveShellJobs,
	abortActiveShellsForMessage,
	claimFinishedShellJobs,
	detachActiveShellJob,
	listShellJobsForSession,
	markShellJobsReported,
	registerActiveShellProcess,
} from '../packages/server/src/runtime/tools/active-shells.ts';
import { createSecureShellExecutor } from '../packages/server/src/tools/adapter/secure-shell.ts';
import type { ToolAdapterContext } from '../packages/server/src/runtime/tools/context.ts';

function registerTestJob(args?: {
	sessionId?: string;
	projectRoot?: string;
	onDetach?: (jobId: string) => void;
	onComplete?: () => void;
	abort?: () => void;
}) {
	return registerActiveShellProcess({
		projectRoot: args?.projectRoot ?? '/tmp/otto-shell-jobs',
		sessionId: args?.sessionId ?? crypto.randomUUID(),
		messageId: crypto.randomUUID(),
		callId: crypto.randomUUID(),
		command: 'bun test',
		cwd: '/tmp/otto-shell-jobs',
		abort: args?.abort ?? (() => {}),
		onDetach: args?.onDetach ?? (() => {}),
		onDetachedCompletion: args?.onComplete,
	});
}

describe('managed shell jobs', () => {
	it('publishes lifecycle and output updates to the session event stream', () => {
		const sessionId = crypto.randomUUID();
		const projectRoot = '/tmp/otto-shell-job-events';
		const events: Array<{ type: string; payload?: unknown }> = [];
		const unsubscribe = subscribe(
			sessionId,
			(event) => events.push(event),
			projectRoot,
		);
		const job = registerActiveShellProcess({
			projectRoot,
			sessionId,
			messageId: crypto.randomUUID(),
			callId: crypto.randomUUID(),
			command: 'printf done',
			cwd: projectRoot,
			abort: () => {},
			onDetach: () => {},
		});
		job.detach();
		job.appendOutput('done');
		job.complete({
			status: 'completed',
			exitCode: 0,
			result: { ok: true, stdout: 'done', exitCode: 0 },
		});
		unsubscribe();

		expect(events.map((event) => event.type)).toEqual([
			'shell.job.updated',
			'shell.job.updated',
			'shell.job.output',
			'shell.job.updated',
		]);
		expect(events[2]?.payload).toMatchObject({
			jobId: job.jobId,
			delta: 'done',
		});
		job.unregister();
	});

	it('lists and detaches jobs through the session API', async () => {
		const sessionId = crypto.randomUUID();
		const projectRoot = process.cwd();
		const detached: string[] = [];
		const job = registerTestJob({
			sessionId,
			projectRoot,
			onDetach: (jobId) => detached.push(jobId),
		});
		const app = createApp();
		const listResponse = await app.request(
			`/v1/sessions/${sessionId}/shell-jobs`,
			{ headers: { 'X-Otto-Project': projectRoot } },
		);
		expect(listResponse.status).toBe(200);
		const listed = (await listResponse.json()) as {
			jobs: Array<{ id: string; detached: boolean }>;
		};
		expect(listed.jobs).toEqual([
			expect.objectContaining({ id: job.jobId, detached: false }),
		]);

		const detachResponse = await app.request(
			`/v1/sessions/${sessionId}/shell-jobs/${job.jobId}/detach`,
			{
				method: 'POST',
				headers: { 'X-Otto-Project': projectRoot },
			},
		);
		expect(detachResponse.status).toBe(200);
		expect(detached).toEqual([job.jobId]);
		job.unregister();
	});

	it('returns immediately for model-requested detached execution', async () => {
		const sessionId = crypto.randomUUID();
		const callId = crypto.randomUUID();
		const projectRoot = process.cwd();
		const executor = createSecureShellExecutor({
			ctx: {
				sessionId,
				messageId: crypto.randomUUID(),
				assistantPartId: crypto.randomUUID(),
				db: {} as ToolAdapterContext['db'],
				agent: 'build',
				provider: 'test',
				model: 'test',
				projectRoot,
				nextIndex: () => 0,
			},
			callId,
		});
		const stream = executor({
			cmd: 'sleep 0.5; printf done',
			cwd: projectRoot,
			allowNonZeroExit: false,
			timeout: 5_000,
			envMode: 'minimal',
			outputMode: 'full',
			tailLines: 100,
			maxOutputBytes: 10_000,
			detached: true,
		});
		const chunks: unknown[] = [];
		for await (const chunk of stream as AsyncIterable<unknown>)
			chunks.push(chunk);
		const immediate = chunks.at(-1) as { result?: Record<string, unknown> };
		expect(immediate.result).toMatchObject({
			ok: true,
			detached: true,
			status: 'running',
		});
		expect(listShellJobsForSession(sessionId, projectRoot)[0]?.status).toBe(
			'running',
		);

		await Bun.sleep(600);
		const [job] = listShellJobsForSession(sessionId, projectRoot);
		expect(job).toMatchObject({
			callId,
			detached: true,
			status: 'completed',
			exitCode: 0,
			output: 'done',
		});
	});

	it('detaches a running inline job without aborting it', () => {
		const sessionId = crypto.randomUUID();
		const detached: string[] = [];
		let aborted = false;
		const job = registerTestJob({
			sessionId,
			onDetach: (jobId) => detached.push(jobId),
			abort: () => {
				aborted = true;
			},
		});

		const snapshot = detachActiveShellJob(
			job.jobId,
			sessionId,
			'/tmp/otto-shell-jobs',
		);
		expect(snapshot?.detached).toBe(true);
		expect(snapshot?.status).toBe('running');
		expect(detached).toEqual([job.jobId]);
		expect(aborted).toBe(false);
		expect(
			abortActiveShellsForMessage(
				sessionId,
				snapshot?.messageId ?? '',
				'/tmp/otto-shell-jobs',
			),
		).toBe(0);
		job.unregister();
	});

	it('retains detached output and exposes completion exactly once', () => {
		const sessionId = crypto.randomUUID();
		let completionNotifications = 0;
		const job = registerTestJob({
			sessionId,
			onComplete: () => {
				completionNotifications++;
			},
		});
		job.detach();
		job.appendOutput('first\n');
		job.appendOutput('second\n');
		job.complete({
			status: 'completed',
			exitCode: 0,
			result: { ok: true, exitCode: 0, stdout: 'first\nsecond\n' },
		});

		const listed = listShellJobsForSession(sessionId, '/tmp/otto-shell-jobs');
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({
			id: job.jobId,
			detached: true,
			status: 'completed',
			exitCode: 0,
			output: 'first\nsecond\n',
		});
		expect(completionNotifications).toBe(1);

		const claimed = claimFinishedShellJobs(sessionId);
		expect(claimed.map((entry) => entry.id)).toEqual([job.jobId]);
		expect(claimFinishedShellJobs(sessionId)).toEqual([]);
		markShellJobsReported([job.jobId]);
		expect(claimFinishedShellJobs(sessionId)).toEqual([]);
		expect(
			listShellJobsForSession(sessionId, '/tmp/otto-shell-jobs')[0]?.reported,
		).toBe(true);
		job.unregister();
	});

	it('removes ordinary inline jobs when they complete', () => {
		const sessionId = crypto.randomUUID();
		const job = registerTestJob({ sessionId });
		job.complete({
			status: 'completed',
			exitCode: 0,
			result: { ok: true, exitCode: 0 },
		});
		expect(listShellJobsForSession(sessionId, '/tmp/otto-shell-jobs')).toEqual(
			[],
		);
	});

	it('aborts detached jobs during daemon shutdown', () => {
		let aborted = false;
		const job = registerTestJob({
			abort: () => {
				aborted = true;
			},
		});
		job.detach();

		expect(abortAllActiveShellJobs()).toBeGreaterThanOrEqual(1);
		expect(aborted).toBe(true);
		job.unregister();
	});
});
