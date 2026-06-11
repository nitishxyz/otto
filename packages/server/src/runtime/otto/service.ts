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
import { publish } from '../../events/bus.ts';

const MAX_STALLED_WAKEUPS = 3;

type SessionRow = typeof sessions.$inferSelect;
type GoalRow = typeof goals.$inferSelect;
type GoalTaskRow = typeof goalTasks.$inferSelect;

type StallState = {
	stalls: number;
	lastHash: string;
};

const stallStates = new Map<string, StallState>();

const AUTOMATED_PREFIXES = [
	'[automated]',
	'[otto]',
	'<subagent_results>',
	'<goal_start',
];

/** Clears the stall counter, e.g. when the user explicitly (re)starts a goal. */
export function resetOttoStallState(sessionId: string): void {
	stallStates.delete(sessionId);
}

export type MaybeWakeOttoInput = {
	db: DB;
	cfg: OttoConfig;
	session: SessionRow;
};

/**
 * Wakes the otto agent for a main session when there is an active goal with
 * open tasks or the last run errored. Guarded by a stall cap: wakeups without
 * task progress stop after MAX_STALLED_WAKEUPS until the user intervenes.
 */
export async function maybeWakeOtto(input: MaybeWakeOttoInput): Promise<void> {
	const { db, cfg, session } = input;

	const goal = await findActiveGoal(db, session.id);
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
	if (aborted) {
		stallStates.delete(session.id);
		return;
	}

	const shouldWake = (goal && openTasks.length > 0) || errored;
	if (!shouldWake) {
		stallStates.delete(session.id);
		if (goal && tasks.length > 0 && openTasks.length === 0) {
			await completeGoal(db, goal);
		}
		return;
	}

	const lastUserMessageId = await getLastManualUserMessageId(db, session.id);
	const hash = buildStateHash(tasks, lastUserMessageId, errored);
	const state = stallStates.get(session.id);
	if (state && state.lastHash === hash) {
		state.stalls += 1;
		if (state.stalls >= MAX_STALLED_WAKEUPS) {
			logger.warn('[otto] stall cap reached; waiting for user input', {
				sessionId: session.id,
				stalls: state.stalls,
			});
			return;
		}
	} else {
		stallStates.set(session.id, { stalls: 0, lastHash: hash });
	}

	const ottoSession = await findOrCreateOttoSession(db, cfg, session);
	if (!ottoSession) return;

	const content = await buildOttoWakeMessage({
		db,
		mainSession: session,
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

	logger.info('[otto] woke up for session', {
		sessionId: session.id,
		ottoSessionId: ottoSession.id,
		goalId: goal?.id ?? null,
		errored,
	});
}

async function findActiveGoal(
	db: DB,
	sessionId: string,
): Promise<GoalRow | undefined> {
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
		.orderBy(asc(goalTasks.position));
}

async function completeGoal(db: DB, goal: GoalRow): Promise<void> {
	await db
		.update(goals)
		.set({ status: 'completed', updatedAt: Date.now() })
		.where(eq(goals.id, goal.id));
	if (goal.sessionId) {
		publish({
			type: 'goal.updated',
			sessionId: goal.sessionId,
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
 * Builds a compact tail of the main session conversation (text parts only) so
 * otto can see how the agent answered previous [otto] messages and what the
 * user actually asked for, instead of judging from task state alone.
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

async function findOrCreateOttoSession(
	db: DB,
	cfg: OttoConfig,
	mainSession: SessionRow,
): Promise<SessionRow | undefined> {
	const existing = await db
		.select()
		.from(sessions)
		.where(
			and(
				eq(sessions.parentSessionId, mainSession.id),
				eq(sessions.sessionType, 'otto'),
			),
		)
		.limit(1);
	if (existing.length) return existing[0];

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
			title: 'otto',
			parentSessionId: mainSession.id,
			sessionType: 'otto',
		});
	} catch (error) {
		logger.warn('[otto] failed to create otto session', {
			sessionId: mainSession.id,
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

async function buildOttoWakeMessage(args: {
	db: DB;
	mainSession: SessionRow;
	goal: GoalRow | undefined;
	tasks: GoalTaskRow[];
	errored: boolean;
	lastRunFinishReason: string | null;
}): Promise<string> {
	const lines: string[] = [
		'[otto] Session run finished. Check up on the main session.',
		'',
		`Main session: ${args.mainSession.id}`,
		`Main agent: ${args.mainSession.agent}`,
		`Last run: ${args.errored ? `errored (${args.lastRunFinishReason ?? 'unknown'})` : 'completed'}`,
	];

	if (args.goal) {
		lines.push('', `Active goal: ${args.goal.title} (id: ${args.goal.id})`);
		if (args.tasks.length) {
			lines.push('', 'Tasks:');
			for (const task of args.tasks) {
				const note = task.note ? ` — note: ${task.note}` : '';
				lines.push(
					`- [${task.status}] (id: ${task.id}, position: ${task.position}) ${task.content}${note}`,
				);
			}
		} else {
			lines.push('', 'The goal has no tasks yet.');
		}
	} else {
		lines.push('', 'No active goal for this session.');
	}

	const transcript = await buildRecentTranscript(args.db, args.mainSession.id);
	if (transcript.length) {
		lines.push(
			'',
			'Recent main-session conversation (oldest first; [auto] = automated message, including your own previous [otto] continuations):',
			...transcript.map((line) => `> ${line}`),
		);
	}

	const allSubagents = await args.db
		.select()
		.from(subagents)
		.where(eq(subagents.parentSessionId, args.mainSession.id));
	const running = allSubagents.filter((r) => r.status === 'running');
	const delivered = allSubagents.filter(
		(r) => r.status !== 'running' && r.reported,
	);
	const undelivered = allSubagents.filter(
		(r) => r.status !== 'running' && !r.reported,
	);
	if (running.length) {
		lines.push(
			'',
			`Sub-agents still running for this session: ${running
				.map((r) => r.agent)
				.join(', ')}. Do not enqueue duplicate work for tasks they cover.`,
		);
	}
	if (delivered.length) {
		lines.push(
			'',
			`Sub-agent results ALREADY DELIVERED to the main agent (do not mention or re-send them): ${delivered
				.map((r) => `${r.agent} (${r.status})`)
				.join(', ')}.`,
		);
	}
	if (undelivered.length) {
		lines.push(
			'',
			`Sub-agent results not yet delivered (the server delivers them automatically on the next idle — do NOT copy them into your continuation): ${undelivered
				.map((r) => `${r.agent} (${r.status})`)
				.join(', ')}.`,
		);
	}

	lines.push(
		'',
		'Follow your instructions: verify done_pending claims, update task statuses, and enqueue a continuation into the main session only if work remains or the error needs a retry.',
		'If a previous [otto] message of yours was already answered in the conversation above, act on that answer (complete or reset tasks) — never re-ask the same thing.',
		'Sub-agent results are delivered to the main session automatically — never repeat, summarize, or re-send them. Keep any enqueued continuation to one short line: which task to do next.',
	);
	return lines.join('\n');
}
