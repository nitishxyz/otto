import { logger } from '@ottocode/sdk';
import {
	completeGoal,
	findGoalForIdleSession,
	listGoalTasks,
} from './goals.ts';
import { buildLooperWakeMessage } from './prompts.ts';
import { ensureLooperSessionForGoal } from './session.ts';
import {
	buildStateHash,
	getLastAssistantRun,
	getLastManualUserMessageId,
} from './transcript.ts';
import { clearLooperStallState, shouldStopForLooperStall } from './stall.ts';
import type { MaybeWakeLooperInput } from './types.ts';

/**
 * Wakes the looper agent when a worker session's run finishes and there is an
 * active goal with open tasks. The goal is resolved via goal_tasks.sessionId
 * (task dispatch) or legacy goals.sessionId. Guarded by a per-goal stall cap:
 * wakeups without task progress stop after MAX_STALLED_WAKEUPS until the user
 * intervenes.
 */
export async function maybeWakeLooper(
	input: MaybeWakeLooperInput,
): Promise<void> {
	const { db, cfg, session } = input;

	const goal = await findGoalForIdleSession(db, session.id);
	const tasks = goal ? await listGoalTasks(db, goal.id) : [];
	const openTasks = tasks.filter(
		(task) => task.status !== 'completed' && task.status !== 'cancelled',
	);
	const lastRun = await getLastAssistantRun(db, session.id);
	const aborted =
		lastRun?.isAborted === true || lastRun?.finishReason === 'abort';
	const errored =
		!aborted &&
		(lastRun?.status === 'failed' ||
			lastRun?.status === 'error' ||
			lastRun?.finishReason === 'error');
	const stallKey = goal?.id ?? session.id;
	if (aborted) {
		clearLooperStallState(stallKey, session.id);
		return;
	}

	const shouldWake = Boolean(goal && openTasks.length > 0);
	if (!shouldWake) {
		clearLooperStallState(stallKey);
		if (goal && tasks.length > 0 && openTasks.length === 0) {
			await completeGoal(db, goal);
		}
		return;
	}

	const lastUserMessageId = await getLastManualUserMessageId(db, session.id);
	const hash = buildStateHash(tasks, lastUserMessageId, errored);
	const stall = shouldStopForLooperStall({ stallKey, hash });
	if (stall.stop) {
		logger.warn('[looper] stall cap reached; waiting for user input', {
			goalId: goal?.id ?? null,
			sessionId: session.id,
			stalls: stall.stalls,
		});
		return;
	}

	const looperSession = goal
		? await ensureLooperSessionForGoal(db, cfg, goal)
		: undefined;
	if (!looperSession) return;

	const content = await buildLooperWakeMessage({
		db,
		workerSession: session,
		goal,
		tasks,
		errored,
		lastRunFinishReason: lastRun?.finishReason ?? null,
	});

	const { dispatchAssistantMessage } = await import('../message/service.ts');
	await dispatchAssistantMessage({
		cfg,
		db,
		session: looperSession,
		agent: 'looper',
		provider: looperSession.provider as Parameters<
			typeof dispatchAssistantMessage
		>[0]['provider'],
		model: looperSession.model,
		content,
	});

	logger.info('[looper] woke up', {
		sessionId: session.id,
		looperSessionId: looperSession.id,
		goalId: goal?.id ?? null,
		errored,
	});
}
