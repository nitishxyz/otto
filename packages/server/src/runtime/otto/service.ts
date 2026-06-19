import { and, asc, desc, eq } from 'drizzle-orm';
import type { OttoConfig } from '@ottocode/sdk';
import { hasConfiguredProvider, logger } from '@ottocode/sdk';
import type { DB } from '@ottocode/database';
import {
	goalTasks,
	goals,
	messageParts,
	messages,
	sessions,
	subagents,
} from '@ottocode/database/schema';
import { createSession } from '../session/manager.ts';
import { resolveAgentConfig } from '../agent/registry.ts';
import { selectProviderAndModel } from '../provider/selection.ts';
import { toErrorMessage } from '../errors/handling.ts';
import { publish } from '../../events/bus.ts';

const MAX_STALLED_WAKEUPS = 3;

type SessionRow = typeof sessions.$inferSelect;
type GoalRow = typeof goals.$inferSelect;
type GoalTaskRow = typeof goalTasks.$inferSelect;

type StallState = {
	stalls: number;
	lastHash: string;
};

/** Stall counters keyed by goal id (fallback: session id when no goal). */
const stallStates = new Map<string, StallState>();

const AUTOMATED_PREFIXES = [
	'[automated]',
	'[otto]',
	'<subagent_results>',
	// Legacy worker-goal kickoff marker; retained so old automated messages do
	// not count as manual user input when calculating otto stall state.
	'<goal_start',
	'<otto_kickoff',
	'<otto_wakeup',
];

/**
 * Clears the stall counter for a goal (or legacy session key), e.g. when the
 * user explicitly (re)starts a goal.
 */
export function resetOttoStallState(key: string): void {
	stallStates.delete(key);
}

export type MaybeWakeOttoInput = {
	db: DB;
	cfg: OttoConfig;
	session: SessionRow;
};

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
		(t) => t.status !== 'completed' && t.status !== 'cancelled',
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
		stallStates.delete(stallKey);
		stallStates.delete(session.id);
		return;
	}

	const shouldWake = Boolean(goal && openTasks.length > 0);
	if (!shouldWake) {
		stallStates.delete(stallKey);
		if (goal && tasks.length > 0 && openTasks.length === 0) {
			await completeGoal(db, goal);
		}
		return;
	}

	const lastUserMessageId = await getLastManualUserMessageId(db, session.id);
	const hash = buildStateHash(tasks, lastUserMessageId, errored);
	const state = stallStates.get(stallKey);
	if (state && state.lastHash === hash) {
		state.stalls += 1;
		if (state.stalls >= MAX_STALLED_WAKEUPS) {
			logger.warn('[otto] stall cap reached; waiting for user input', {
				goalId: goal?.id ?? null,
				sessionId: session.id,
				stalls: state.stalls,
			});
			return;
		}
	} else {
		stallStates.set(stallKey, { stalls: 0, lastHash: hash });
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

/**
 * Resolves the active goal an idle session belongs to: first via task
 * dispatch (goal_tasks.sessionId), then via the legacy session binding
 * (goals.sessionId).
 */
async function findGoalForIdleSession(
	db: DB,
	sessionId: string,
): Promise<GoalRow | undefined> {
	const viaTask = await db
		.select({ goal: goals })
		.from(goalTasks)
		.innerJoin(goals, eq(goalTasks.goalId, goals.id))
		.where(and(eq(goalTasks.sessionId, sessionId), eq(goals.status, 'active')))
		.orderBy(asc(goals.createdAt))
		.limit(1);
	if (viaTask[0]) return viaTask[0].goal;
	const rows = await db
		.select()
		.from(goals)
		.where(and(eq(goals.sessionId, sessionId), eq(goals.status, 'active')))
		.orderBy(asc(goals.createdAt))
		.limit(1);
	return rows[0];
}

async function listGoalTasks(db: DB, goalId: string): Promise<GoalTaskRow[]> {
	return await db
		.select()
		.from(goalTasks)
		.where(eq(goalTasks.goalId, goalId))
		.orderBy(asc(goalTasks.position), asc(goalTasks.createdAt));
}

async function completeGoal(db: DB, goal: GoalRow): Promise<void> {
	await db
		.update(goals)
		.set({ status: 'completed', updatedAt: Date.now() })
		.where(eq(goals.id, goal.id));
	const eventSessionId = goal.ottoSessionId ?? goal.sessionId;
	if (eventSessionId) {
		publish({
			type: 'goal.updated',
			sessionId: eventSessionId,
			payload: { goalId: goal.id, changes: ['goal completed'] },
		});
	}
	logger.info('[otto] goal completed', { goalId: goal.id });
}

async function getLastAssistantRun(db: DB, sessionId: string) {
	const rows = await db
		.select({
			id: messages.id,
			status: messages.status,
			finishReason: messages.finishReason,
			isAborted: messages.isAborted,
		})
		.from(messages)
		.where(
			and(eq(messages.sessionId, sessionId), eq(messages.role, 'assistant')),
		)
		.orderBy(desc(messages.createdAt))
		.limit(1);
	return rows[0];
}

async function getLastManualUserMessageId(
	db: DB,
	sessionId: string,
): Promise<string | null> {
	const rows = await db
		.select({ id: messages.id })
		.from(messages)
		.where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
		.orderBy(desc(messages.createdAt))
		.limit(20);
	for (const row of rows) {
		const parts = await db
			.select({ content: messageParts.content })
			.from(messageParts)
			.where(eq(messageParts.messageId, row.id))
			.orderBy(asc(messageParts.index))
			.limit(1);
		const raw = parts[0]?.content;
		if (!raw) return row.id;
		let text = '';
		try {
			text = String(JSON.parse(raw)?.text ?? '');
		} catch {
			text = raw;
		}
		const automated = AUTOMATED_PREFIXES.some((prefix) =>
			text.trimStart().startsWith(prefix),
		);
		if (!automated) return row.id;
	}
	return null;
}

function buildStateHash(
	tasks: GoalTaskRow[],
	lastUserMessageId: string | null,
	errored: boolean,
): string {
	const taskPart = tasks.map((t) => `${t.id}:${t.status}`).join('|');
	return `${taskPart}::${lastUserMessageId ?? ''}::${errored ? 'err' : 'ok'}`;
}

const TRANSCRIPT_MESSAGES = 8;
const TRANSCRIPT_PART_LIMIT = 700;

/**
 * Builds a compact tail of the worker session conversation (text parts only)
 * so otto can see how the agent answered previous [otto] messages and what
 * the user actually asked for, instead of judging from task state alone.
 */
async function buildRecentTranscript(
	db: DB,
	sessionId: string,
): Promise<string[]> {
	const rows = await db
		.select({ id: messages.id, role: messages.role })
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(desc(messages.createdAt))
		.limit(TRANSCRIPT_MESSAGES);
	rows.reverse();

	const lines: string[] = [];
	for (const row of rows) {
		const parts = await db
			.select({ type: messageParts.type, content: messageParts.content })
			.from(messageParts)
			.where(eq(messageParts.messageId, row.id))
			.orderBy(asc(messageParts.index));
		const texts: string[] = [];
		for (const part of parts) {
			if (part.type !== 'text' || !part.content) continue;
			try {
				const text = String(JSON.parse(part.content)?.text ?? '').trim();
				if (text) texts.push(text);
			} catch {}
		}
		if (!texts.length) continue;
		let combined = texts.join('\n').replace(/\s+\n/g, '\n').trim();
		if (combined.length > TRANSCRIPT_PART_LIMIT) {
			combined = `${combined.slice(0, TRANSCRIPT_PART_LIMIT)}…`;
		}
		const automated = AUTOMATED_PREFIXES.some((prefix) =>
			combined.trimStart().startsWith(prefix),
		);
		const label =
			row.role === 'assistant' ? 'assistant' : automated ? 'auto' : 'user';
		lines.push(`[${label}] ${combined}`);
	}
	return lines;
}

/**
 * Returns the otto session that owns a goal, creating and binding one
 * (goals.ottoSessionId) when missing. Migrates legacy goals whose otto
 * session was a child of the supervised session.
 */
export async function ensureOttoSessionForGoal(
	db: DB,
	cfg: OttoConfig,
	goal: GoalRow,
): Promise<SessionRow | undefined> {
	if (goal.ottoSessionId) {
		const rows = await db
			.select()
			.from(sessions)
			.where(eq(sessions.id, goal.ottoSessionId))
			.limit(1);
		if (rows[0]?.sessionType === 'otto') return rows[0];
		if (rows[0]) {
			logger.warn('[otto] goal bound to non-otto session; rebinding', {
				goalId: goal.id,
				boundSessionId: rows[0].id,
				sessionType: rows[0].sessionType,
			});
		}
	}

	// Legacy binding: otto session created as a child of the supervised session.
	if (goal.sessionId) {
		const legacy = await db
			.select()
			.from(sessions)
			.where(
				and(
					eq(sessions.parentSessionId, goal.sessionId),
					eq(sessions.sessionType, 'otto'),
				),
			)
			.limit(1);
		if (legacy[0]) {
			await db
				.update(goals)
				.set({ ottoSessionId: legacy[0].id, updatedAt: Date.now() })
				.where(eq(goals.id, goal.id));
			return legacy[0];
		}
	}

	const created = await createOttoSession(db, cfg, {
		title: goal.title,
	});
	if (!created) return undefined;
	await db
		.update(goals)
		.set({ ottoSessionId: created.id, updatedAt: Date.now() })
		.where(eq(goals.id, goal.id));
	return created;
}

async function createOttoSession(
	db: DB,
	cfg: OttoConfig,
	opts: { title: string | null; parentSessionId?: string },
): Promise<SessionRow | undefined> {
	try {
		const agentCfg = await resolveAgentConfig(cfg.projectRoot, 'otto');
		const agentProviderDefault = hasConfiguredProvider(cfg, agentCfg.provider)
			? agentCfg.provider
			: cfg.defaults.provider;
		const agentModelDefault = agentCfg.model ?? cfg.defaults.model;
		const selection = await selectProviderAndModel({
			cfg,
			agentProviderDefault,
			agentModelDefault,
		});
		return await createSession({
			db,
			cfg,
			agent: 'otto',
			provider: selection.provider,
			model: selection.model,
			title: opts.title,
			parentSessionId: opts.parentSessionId,
			sessionType: 'otto',
		});
	} catch (error) {
		logger.warn('[otto] failed to create otto session', {
			error: toErrorMessage(error),
		});
		return undefined;
	}
}

/**
 * Builds the kickoff message dispatched into a goal's otto session when the
 * user starts the goal. Otto plans dispatch from here. Wrapped in
 * <otto_kickoff> so clients render it as structured UI instead of raw text.
 */
export function buildGoalKickoffMessage(
	goal: GoalRow,
	tasks: GoalTaskRow[],
): string {
	const lines: string[] = [
		`<otto_kickoff goal-id="${goal.id}">`,
		`<title>${goal.title}</title>`,
	];
	if (tasks.length) {
		lines.push('<tasks>');
		for (const task of tasks) {
			lines.push(
				`<task id="${task.id}" status="${task.status}" position="${task.position}">${task.content}${task.note ? ` <note>${task.note}</note>` : ''}</task>`,
			);
		}
		lines.push('</tasks>');
	} else {
		lines.push('<tasks />');
	}
	if (goal.sessionId) {
		lines.push(
			`<legacy-worker-session>${goal.sessionId}</legacy-worker-session>`,
		);
	}
	lines.push(
		'<instructions>',
		'The user started this goal. You orchestrate it.',
		tasks.length
			? 'Dispatch the first open task(s): mark them in_progress via goal_update (recording the worker sessionId), then delegate with delegate_task or enqueue into a worker session. Independent tasks may run in parallel.'
			: 'The goal has no tasks yet. Create them with goal_update.',
		'</instructions>',
		'</otto_kickoff>',
	);
	return lines.join('\n');
}

/**
 * Builds the wakeup message dispatched into otto when a worker session run
 * finishes. Wrapped in <otto_wakeup> for structured client rendering.
 */
async function buildOttoWakeMessage(args: {
	db: DB;
	workerSession: SessionRow;
	goal: GoalRow | undefined;
	tasks: GoalTaskRow[];
	errored: boolean;
	lastRunFinishReason: string | null;
}): Promise<string> {
	const lastRun = args.errored
		? `errored:${args.lastRunFinishReason ?? 'unknown'}`
		: 'completed';
	const lines: string[] = [
		`<otto_wakeup worker-session-id="${args.workerSession.id}" worker-agent="${args.workerSession.agent}" last-run="${lastRun}">`,
	];

	if (args.goal) {
		lines.push(`<goal id="${args.goal.id}"><title>${args.goal.title}</title>`);
		if (args.tasks.length) {
			lines.push('<tasks>');
			for (const task of args.tasks) {
				const worker = task.sessionId
					? ` worker-session-id="${task.sessionId}"`
					: '';
				lines.push(
					`<task id="${task.id}" status="${task.status}" position="${task.position}"${worker}>${task.content}${task.note ? ` <note>${task.note}</note>` : ''}</task>`,
				);
			}
			lines.push('</tasks>');
		} else {
			lines.push('<tasks />');
		}
		lines.push('</goal>');
	} else {
		lines.push('<goal />');
	}

	const transcript = await buildRecentTranscript(
		args.db,
		args.workerSession.id,
	);
	if (transcript.length) {
		lines.push(
			'<transcript note="oldest first; [auto] = automated message, including your own previous [otto] continuations">',
			...transcript,
			'</transcript>',
		);
	}

	const allSubagents = await args.db
		.select()
		.from(subagents)
		.where(eq(subagents.parentSessionId, args.workerSession.id));
	const running = allSubagents.filter((r) => r.status === 'running');
	const delivered = allSubagents.filter(
		(r) => r.status !== 'running' && r.reported,
	);
	const undelivered = allSubagents.filter(
		(r) => r.status !== 'running' && !r.reported,
	);
	if (running.length || delivered.length || undelivered.length) {
		lines.push('<subagents>');
		for (const r of running) {
			lines.push(
				`<subagent agent="${r.agent}" status="running" note="Do not dispatch duplicate work for tasks it covers." />`,
			);
		}
		for (const r of delivered) {
			lines.push(
				`<subagent agent="${r.agent}" status="${r.status}" delivered="true" note="Result already delivered to the worker agent; do not mention or re-send it." />`,
			);
		}
		for (const r of undelivered) {
			lines.push(
				`<subagent agent="${r.agent}" status="${r.status}" delivered="false" note="Delivered automatically on next idle; do NOT copy it into your continuation." />`,
			);
		}
		lines.push('</subagents>');
	}

	lines.push(
		'<instructions>',
		'A worker session run finished. Check up on it.',
		'Follow your instructions: verify finished work, update task statuses, and dispatch or enqueue a continuation only if work remains or the error needs a retry.',
		'If a previous [otto] message of yours was already answered in the conversation above, act on that answer (complete or keep tasks with a note) — never re-ask the same thing.',
		'Sub-agent results are delivered to the dispatching session automatically — never repeat, summarize, or re-send them. Keep any enqueued continuation to one short line: which task to do next.',
		'</instructions>',
		'</otto_wakeup>',
	);
	return lines.join('\n');
}
