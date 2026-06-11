import { and, asc, desc, eq } from 'drizzle-orm';
import type { OttoConfig } from '@ottocode/sdk';
import { hasConfiguredProvider, logger } from '@ottocode/sdk';
import type { DB } from '@ottocode/database';
import { messageParts, messages, subagents } from '@ottocode/database/schema';
import { publish } from '../../events/bus.ts';
import { createSession, getSessionById } from '../session/manager.ts';
import { resolveAgentConfig, discoverAllAgents } from '../agent/registry.ts';
import { selectProviderAndModel } from '../provider/selection.ts';
import { abortSession, getRunnerState } from '../session/queue.ts';

const MAX_CONCURRENT_PER_PARENT = 3;

export type SubagentRecord = typeof subagents.$inferSelect;

export type SpawnSubagentInput = {
	db: DB;
	cfg: OttoConfig;
	parentSessionId: string;
	parentAgent: string;
	agent: string;
	task: string;
	context?: string;
	/**
	 * Existing subagent child session to dispatch the new task into instead of
	 * creating a fresh session. Keeps prior context for related tasks (e.g.
	 * frontend task 1 → frontend task 3). Must belong to the same parent and
	 * the same agent, and must not be running.
	 */
	reuseSessionId?: string;
};

export type SpawnSubagentResult =
	| { ok: true; subagentId: string; childSessionId: string; agent: string }
	| { ok: false; error: string };

/**
 * Spawns an async sub-agent run in a new child session, or resumes an
 * existing child session when reuseSessionId is provided.
 */
export async function spawnSubagent(
	input: SpawnSubagentInput,
): Promise<SpawnSubagentResult> {
	const {
		db,
		cfg,
		parentSessionId,
		parentAgent,
		agent,
		task,
		context,
		reuseSessionId,
	} = input;

	const targetAgent = agent.trim();
	if (!targetAgent) return { ok: false, error: 'Target agent is required.' };
	if (targetAgent === parentAgent) {
		return {
			ok: false,
			error: 'Cannot delegate to the same agent that is delegating.',
		};
	}
	if (targetAgent === 'otto') {
		return { ok: false, error: 'Cannot delegate to the otto agent.' };
	}

	const knownAgents = await discoverAllAgents(cfg.projectRoot);
	if (!knownAgents.includes(targetAgent)) {
		return {
			ok: false,
			error: `Unknown agent "${targetAgent}". Available agents: ${knownAgents.join(', ')}`,
		};
	}

	const running = await db
		.select({ id: subagents.id })
		.from(subagents)
		.where(
			and(
				eq(subagents.parentSessionId, parentSessionId),
				eq(subagents.status, 'running'),
			),
		);
	if (running.length >= MAX_CONCURRENT_PER_PARENT) {
		return {
			ok: false,
			error: `Too many running sub-agents (max ${MAX_CONCURRENT_PER_PARENT}). Wait for one to finish or check list_subagents.`,
		};
	}

	let childSession: SessionRowForSpawn;
	let isReuse = false;
	if (reuseSessionId) {
		const reuse = await resolveReusableChildSession({
			db,
			parentSessionId,
			targetAgent,
			reuseSessionId,
		});
		if (!reuse.ok) return { ok: false, error: reuse.error };
		childSession = reuse.session;
		isReuse = true;
	} else {
		const agentCfg = await resolveAgentConfig(cfg.projectRoot, targetAgent);
		const agentProviderDefault = hasConfiguredProvider(cfg, agentCfg.provider)
			? agentCfg.provider
			: cfg.defaults.provider;
		const agentModelDefault = agentCfg.model ?? cfg.defaults.model;
		const selection = await selectProviderAndModel({
			cfg,
			agentProviderDefault,
			agentModelDefault,
		});
		childSession = await createSession({
			db,
			cfg,
			agent: targetAgent,
			provider: selection.provider,
			model: selection.model,
			title: `Sub-agent: ${task.slice(0, 60)}`,
			parentSessionId,
			sessionType: 'subagent',
		});
	}

	const subagentId = crypto.randomUUID();
	const now = Date.now();
	await db.insert(subagents).values({
		id: subagentId,
		parentSessionId,
		childSessionId: childSession.id,
		agent: targetAgent,
		task,
		status: 'running',
		summary: null,
		reported: false,
		createdAt: now,
		updatedAt: now,
	});

	const prompt = buildSubagentPrompt({
		parentSessionId,
		parentAgent,
		task,
		context,
		isReuse,
	});

	const { dispatchAssistantMessage } = await import('../message/service.ts');
	await dispatchAssistantMessage({
		cfg,
		db,
		session: childSession,
		agent: targetAgent,
		provider: childSession.provider as Parameters<
			typeof dispatchAssistantMessage
		>[0]['provider'],
		model: childSession.model,
		content: prompt,
	});

	publish({
		type: 'session.updated',
		sessionId: parentSessionId,
		payload: {
			id: parentSessionId,
			subagentSpawned: {
				subagentId,
				childSessionId: childSession.id,
				agent: targetAgent,
			},
		},
	});

	logger.info('[subagent] spawned', {
		subagentId,
		parentSessionId,
		childSessionId: childSession.id,
		agent: targetAgent,
		provider: childSession.provider,
		model: childSession.model,
		reused: isReuse,
	});

	return {
		ok: true,
		subagentId,
		childSessionId: childSession.id,
		agent: targetAgent,
	};
}

type SessionRowForSpawn = Awaited<ReturnType<typeof createSession>>;

async function resolveReusableChildSession(args: {
	db: DB;
	parentSessionId: string;
	targetAgent: string;
	reuseSessionId: string;
}): Promise<
	{ ok: true; session: SessionRowForSpawn } | { ok: false; error: string }
> {
	const { db, parentSessionId, targetAgent, reuseSessionId } = args;
	const session = await getSessionById({ db, sessionId: reuseSessionId });
	if (!session) {
		return {
			ok: false,
			error: `Reuse session "${reuseSessionId}" not found. Delegate without reuseSessionId to start fresh.`,
		};
	}
	if (
		session.sessionType !== 'subagent' ||
		session.parentSessionId !== parentSessionId
	) {
		return {
			ok: false,
			error:
				'Reuse session must be a sub-agent session previously spawned from this session.',
		};
	}
	if (session.agent !== targetAgent) {
		return {
			ok: false,
			error: `Reuse session belongs to agent "${session.agent}", not "${targetAgent}". Reuse is only valid for the same agent.`,
		};
	}
	const records = await db
		.select({ status: subagents.status })
		.from(subagents)
		.where(eq(subagents.childSessionId, reuseSessionId));
	if (records.some((r) => r.status === 'running')) {
		return {
			ok: false,
			error:
				'Reuse session is still running a task. Wait for it to finish or delegate to a fresh session.',
		};
	}
	return { ok: true, session };
}

function buildSubagentPrompt(args: {
	parentSessionId: string;
	parentAgent: string;
	task: string;
	context?: string;
	isReuse?: boolean;
}): string {
	const lines = [
		args.isReuse
			? 'You are running as a delegated sub-agent, continuing in a session you used for earlier related work. Your prior context (files explored, changes made) still applies — build on it instead of re-discovering.'
			: 'You are running as a delegated sub-agent.',
		'',
		`Parent session: ${args.parentSessionId}`,
		`Delegated by agent: ${args.parentAgent}`,
		'',
		args.isReuse ? 'New task:' : 'Task:',
		args.task,
	];
	if (args.context?.trim()) {
		lines.push(
			'',
			'Additional context from the delegating agent:',
			args.context,
		);
	}
	lines.push(
		'',
		'Complete the task, then END your final message with a structured result report. This report is the only thing the delegating agent sees — it is used to verify and accept your work, so make it factual and complete:',
		'',
		'## Result',
		'- Outcome: what was accomplished (or why it failed / was partially done)',
		'- Files changed: exact paths created/modified/deleted (or "none")',
		'- Verification: what you ran to check the work (commands, tests, lint) and their results (or "none")',
		'- Open issues: anything unresolved, follow-ups needed, or assumptions made (or "none")',
		'',
		'Never claim verification you did not perform. Do not ask the user follow-up questions.',
	);
	return lines.join('\n');
}
/** Lists sub-agent records spawned from a parent session. */
export async function listSubagentsForSession(
	db: DB,
	parentSessionId: string,
): Promise<SubagentRecord[]> {
	return await db
		.select()
		.from(subagents)
		.where(eq(subagents.parentSessionId, parentSessionId))
		.orderBy(asc(subagents.createdAt));
}

/**
 * Marks sub-agent records as reported, e.g. when the parent agent has already
 * seen their summaries via list_subagents, so the idle hook does not deliver
 * the same results again.
 */
export async function markSubagentsReported(
	db: DB,
	ids: string[],
): Promise<void> {
	if (!ids.length) return;
	const now = Date.now();
	for (const id of ids) {
		await db
			.update(subagents)
			.set({ reported: true, updatedAt: now })
			.where(eq(subagents.id, id));
	}
}

export type MessageSubagentInput = {
	db: DB;
	cfg: OttoConfig;
	parentSessionId: string;
	subagentId: string;
	message: string;
};

export type MessageSubagentResult =
	| { ok: true; subagentId: string; childSessionId: string; agent: string }
	| { ok: false; error: string };

/**
 * Sends a follow-up message to an existing sub-agent's child session,
 * resuming it with full prior context. The record goes back to 'running'
 * and the parent is woken again when the follow-up finishes.
 */
export async function messageSubagent(
	input: MessageSubagentInput,
): Promise<MessageSubagentResult> {
	const { db, cfg, parentSessionId, subagentId, message } = input;

	const rows = await db
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.id, subagentId),
				eq(subagents.parentSessionId, parentSessionId),
			),
		)
		.limit(1);
	const record = rows[0];
	if (!record) {
		return {
			ok: false,
			error: `No sub-agent with id "${subagentId}" for this session. Use list_subagents to find ids.`,
		};
	}
	if (record.status === 'running') {
		return {
			ok: false,
			error:
				'Sub-agent is still running. Wait for its result before following up.',
		};
	}
	if (record.status === 'cancelled') {
		return {
			ok: false,
			error:
				'Sub-agent was cancelled; its session may be incomplete. Use delegate_task to start a fresh one.',
		};
	}

	const childSession = await getSessionById({
		db,
		sessionId: record.childSessionId,
	});
	if (!childSession) {
		return { ok: false, error: 'Sub-agent session no longer exists.' };
	}

	const now = Date.now();
	await db
		.update(subagents)
		.set({ status: 'running', reported: false, updatedAt: now })
		.where(eq(subagents.id, record.id));

	const { dispatchAssistantMessage } = await import('../message/service.ts');
	await dispatchAssistantMessage({
		cfg,
		db,
		session: childSession,
		agent: childSession.agent,
		provider: childSession.provider as Parameters<
			typeof dispatchAssistantMessage
		>[0]['provider'],
		model: childSession.model,
		content: [
			'Follow-up from the delegating agent:',
			'',
			message,
			'',
			'You still have your prior context. Complete this follow-up and END with the same structured "## Result" report (Outcome, Files changed, Verification, Open issues). Never claim verification you did not perform.',
		].join('\n'),
	});

	logger.info('[subagent] follow-up sent', {
		subagentId: record.id,
		parentSessionId,
		childSessionId: record.childSessionId,
	});

	return {
		ok: true,
		subagentId: record.id,
		childSessionId: record.childSessionId,
		agent: record.agent,
	};
}

/**
 * Finalizes the sub-agent record for a child session whose run just finished.
 * Returns the updated record, or undefined when the session is not a running sub-agent.
 */
export async function finalizeSubagentForChildSession(
	db: DB,
	childSessionId: string,
): Promise<SubagentRecord | undefined> {
	const rows = await db
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.childSessionId, childSessionId),
				eq(subagents.status, 'running'),
			),
		)
		.limit(1);
	if (!rows.length) return undefined;
	const record = rows[0];

	const lastAssistant = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, childSessionId))
		.orderBy(desc(messages.createdAt))
		.limit(5);
	const assistantMessage = lastAssistant.find((m) => m.role === 'assistant');

	let summary = '';
	let failed = false;
	if (assistantMessage) {
		failed =
			assistantMessage.status === 'error' ||
			assistantMessage.finishReason === 'error';
		summary = await extractAssistantText(db, assistantMessage.id);
	}
	if (!summary) {
		summary = failed
			? 'Sub-agent run failed without producing output.'
			: 'Sub-agent finished without a text summary.';
	}

	const status = failed ? 'failed' : 'completed';
	const updatedAt = Date.now();
	await db
		.update(subagents)
		.set({ status, summary, updatedAt })
		.where(eq(subagents.id, record.id));

	logger.info('[subagent] finalized', {
		subagentId: record.id,
		parentSessionId: record.parentSessionId,
		status,
	});

	return { ...record, status, summary, updatedAt };
}

async function extractAssistantText(
	db: DB,
	messageId: string,
): Promise<string> {
	const parts = await db
		.select()
		.from(messageParts)
		.where(eq(messageParts.messageId, messageId))
		.orderBy(asc(messageParts.index));
	const chunks: string[] = [];
	for (const part of parts) {
		if (part.type !== 'text' || !part.content) continue;
		try {
			const parsed = JSON.parse(part.content);
			if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) {
				chunks.push(parsed.text);
			}
		} catch {}
	}
	return chunks.join('\n').trim();
}

/**
 * Reports unreported finished sub-agents to their parent session by
 * enqueueing a continuation run. Only runs when the parent is idle.
 */
export async function reportFinishedSubagents(
	db: DB,
	cfg: OttoConfig,
	parentSessionId: string,
): Promise<boolean> {
	const state = getRunnerState(parentSessionId);
	if (state && (state.running || state.queue.length > 0)) return false;

	const unreported = await db
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.parentSessionId, parentSessionId),
				eq(subagents.reported, false),
			),
		)
		.orderBy(asc(subagents.createdAt));
	const finished = unreported.filter((r) => r.status !== 'running');
	if (!finished.length) return false;

	const parentSession = await getSessionById({
		db,
		sessionId: parentSessionId,
	});
	if (!parentSession) return false;

	const now = Date.now();
	for (const record of finished) {
		await db
			.update(subagents)
			.set({ reported: true, updatedAt: now })
			.where(eq(subagents.id, record.id));
	}

	const sections = finished.map((record) => {
		const attrs = `id="${record.id}" agent="${record.agent}" status="${record.status}"`;
		return [
			`<subagent_result ${attrs}>`,
			`<task>${record.task}</task>`,
			'<result>',
			record.summary ?? '(no summary)',
			'</result>',
			'</subagent_result>',
		].join('\n');
	});
	const content = [
		'<subagent_results>',
		sections.join('\n\n'),
		'</subagent_results>',
		'',
		'Continue your work using these results. If a sub-agent failed, decide whether to follow up with message_subagent, delegate again, or handle it yourself.',
	].join('\n');

	const { dispatchAssistantMessage } = await import('../message/service.ts');
	await dispatchAssistantMessage({
		cfg,
		db,
		session: parentSession,
		agent: parentSession.agent,
		provider: parentSession.provider as Parameters<
			typeof dispatchAssistantMessage
		>[0]['provider'],
		model: parentSession.model,
		content,
	});

	logger.info('[subagent] reported results to parent', {
		parentSessionId,
		count: finished.length,
	});
	return true;
}

/** Aborts all running sub-agent child sessions for a parent session. */
export async function abortChildSubagents(
	db: DB,
	parentSessionId: string,
): Promise<void> {
	const running = await db
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.parentSessionId, parentSessionId),
				eq(subagents.status, 'running'),
			),
		);
	if (!running.length) return;
	const now = Date.now();
	for (const record of running) {
		abortSession(record.childSessionId, true, {
			type: 'parent-session-aborted',
		});
		await db
			.update(subagents)
			.set({
				status: 'cancelled',
				summary: 'Cancelled because the parent session was aborted.',
				reported: true,
				updatedAt: now,
			})
			.where(eq(subagents.id, record.id));
	}
	logger.info('[subagent] cascaded abort to children', {
		parentSessionId,
		count: running.length,
	});
}
