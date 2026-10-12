import { loadConfig, logger } from '@ottocode/sdk';
import { getDb } from '@ottocode/database';
import { getSessionById } from '../session/manager.ts';
import {
	acquireSessionRunner,
	getRunnerState,
	releaseSessionRunner,
	takeNextJobOrRelease,
} from '../session/queue/lifecycle.ts';
import { toErrorMessage } from '../errors/handling.ts';
import { markUnhandledAssistantRunFailure } from './runner/runner-failures.ts';
import { executeAssistantTurn } from './turn/execute.ts';
import type { RunSessionLoop } from './turn/types.ts';
import type { RunOpts } from '../session/queue/types.ts';
import {
	withQueuedCredentials,
	withRequestCredentials,
} from '../provider/credentials.ts';

export {
	enqueueAssistantRun,
	abortSession,
	abortMessage,
	removeFromQueue,
	sendQueuedMessageNow,
	getQueueState,
	getRunnerState,
} from '../session/queue.ts';

type SessionLoopDeps = {
	execute: (job: RunOpts, runSessionLoop: RunSessionLoop) => Promise<void>;
	onFailure: (job: RunOpts, error: unknown) => Promise<void>;
	onIdle: (
		sessionId: string,
		projectRoot: string,
		finishedMessageId?: string,
	) => Promise<void>;
};

async function scheduleSessionIdle(
	sessionId: string,
	projectRoot: string,
	finishedMessageId?: string,
) {
	try {
		if (finishedMessageId) {
			const cfg = await loadConfig(projectRoot);
			const db = await getDb(cfg.projectRoot);
			const session = await getSessionById({ db, sessionId });
			const state = getRunnerState(sessionId, projectRoot);
			if (state?.running || state?.queue.length) return;
			if (session?.sessionType === 'subagent') {
				const { finalizeSubagentForChildSession, reportFinishedSubagents } =
					await import('../subagents/service.ts');
				const record = await finalizeSubagentForChildSession(db, sessionId, {
					finishedMessageId,
				});
				if (record)
					await reportFinishedSubagents(db, cfg, record.parentSessionId);
				return;
			}
		}
		const { handleSessionIdle } = await import('../subagents/idle.ts');
		await handleSessionIdle(sessionId, projectRoot);
	} catch (error) {
		logger.debug('[agent] failed to schedule session idle handler', {
			sessionId,
			projectRoot,
			error: toErrorMessage(error),
		});
	}
}

/**
 * Builds a queue-draining loop. The runner is claimed synchronously and the
 * dequeue/empty-check/release step is atomic, so a job enqueued at any point
 * is either picked up by the active loop or starts a new one.
 */
export function createSessionLoop(deps: SessionLoopDeps): RunSessionLoop {
	const loop: RunSessionLoop = async (sessionId, requestedProjectRoot) => {
		const projectRoot =
			requestedProjectRoot ?? getRunnerState(sessionId)?.projectRoot;
		if (!acquireSessionRunner(sessionId, projectRoot)) return;

		let lastProjectRoot = projectRoot;
		let finishedMessageId: string | undefined;
		let released = false;
		try {
			while (true) {
				const job = takeNextJobOrRelease(sessionId, projectRoot);
				if (!job) {
					released = true;
					break;
				}
				lastProjectRoot = job.projectRoot;
				await withQueuedCredentials(job, async () => {
					try {
						await deps.execute(job, loop);
					} catch (err) {
						await deps.onFailure(job, err);
					}
				});
				finishedMessageId = job.assistantMessageId;
			}
		} finally {
			if (!released && releaseSessionRunner(sessionId, projectRoot)) {
				void loop(sessionId, projectRoot);
			}
		}

		if (lastProjectRoot)
			await withRequestCredentials({}, () =>
				deps.onIdle(sessionId, lastProjectRoot, finishedMessageId),
			);
	};
	return loop;
}

export const runSessionLoop: RunSessionLoop = createSessionLoop({
	execute: (job, loop) => executeAssistantTurn(job, loop),
	onFailure: markUnhandledAssistantRunFailure,
	onIdle: scheduleSessionIdle,
});
