import { logger } from '@ottocode/sdk';
import {
	completeGoal,
	findGoalForIdleSession,
	listGoalTasks,
} from './goals.ts';
import { buildOttoWakeMessage } from './prompts.ts';
import { ensureOttoSessionForGoal } from './session.ts';
import {
	buildStateHash,
	getLastAssistantRun,
	getLastManualUserMessageId,
} from './transcript.ts';
import { clearOttoStallState, shouldStopForOttoStall } from './stall.ts';
import type { MaybeWakeOttoInput } from './types.ts';

/**
 * Wakes the otto agent when a worker session's run finishes and there is an
 * active goal with open tasks. The goal is resolved via goal_tasks.sessionId
 * (task dispatch) or legacy goals.sessionId. Guarded by a per-goal stall cap:
 * wakeups without task progress stop after MAX_STALLED_WAKEUPS until the user
 * intervenes.
 */
export async function maybeWakeOtto(input: MaybeWakeOttoInput): Promise<void> {
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
		clearOttoStallState(stallKey, session.id);
		return;
	}

	const shouldWake = Boolean(goal && openTasks.length > 0);
	if (!shouldWake) {
		clearOttoStallState(stallKey);
		if (goal && tasks.length > 0 && openTasks.length === 0) {
			await completeGoal(db, goal);
		}
		return;
	}

	const lastUserMessageId = await getLastManualUserMessageId(db, session.id);
	const hash = buildStateHash(tasks, lastUserMessageId, errored);
	const stall = shouldStopForOttoStall({ stallKey, hash });
	if (stall.stop) {
		logger.warn('[otto] stall cap reached; waiting for user input', {
			goalId: goal?.id ?? null,
			sessionId: session.id,
			stalls: stall.stalls,
		});
		return;
	}

	const ottoSession = goal
		? await ensureOttoSessionForGoal(db, cfg, goal)
		: undefined;
	if (!ottoSession) return;

	const content = await buildOttoWakeMessage({
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
		session: ottoSession,
		agent: 'otto',
		provider: ottoSession.provider as Parameters<
			typeof dispatchAssistantMessage
		>[0]['provider'],
		model: ottoSession.model,
		content,
	});

	logger.info('[otto] woke up', {
		sessionId: session.id,
		ottoSessionId: ottoSession.id,
		goalId: goal?.id ?? null,
		errored,
	});
}
