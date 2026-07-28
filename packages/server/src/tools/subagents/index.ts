import { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';
import { tool } from 'ai';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v3';
import {
	compactSubagent,
	getSubagentStatus,
	listSubagentsForSession,
	markSubagentsReported,
	messageSubagent,
	readSubagentActivity,
	retrySubagent,
	spawnSubagent,
	stopSubagent,
} from '../../runtime/subagents/service.ts';

const subagentInputSchema = z.object({
	action: z.enum([
		'delegate',
		'list',
		'status',
		'read',
		'message',
		'compact',
		'stop',
		'retry',
	]),
	agent: z.string().optional().describe('Agent name; required for delegate'),
	task: z.string().optional().describe('Task; required for delegate'),
	context: z.string().optional().describe('Optional delegate context'),
	reuseSessionId: z
		.string()
		.optional()
		.describe('Prior child session id for related delegate work'),
	status: z
		.enum(['running', 'completed', 'failed', 'cancelled'])
		.optional()
		.describe('Optional list filter'),
	subagentId: z
		.string()
		.optional()
		.describe('Required for status, read, message, compact, stop, and retry'),
	message: z.string().optional().describe('Required for message'),
	delivery: z
		.enum(['queue', 'interrupt'])
		.optional()
		.describe('Message delivery; defaults to queue'),
	limit: z
		.number()
		.int()
		.min(1)
		.max(20)
		.optional()
		.describe('Recent tool calls returned by read; defaults to 5'),
});

type SubagentInput = z.infer<typeof subagentInputSchema>;

function requiredText(
	input: SubagentInput,
	key: 'agent' | 'task' | 'subagentId' | 'message',
): string | undefined {
	const value = input[key]?.trim();
	return value || undefined;
}

/** Builds the unified sub-agent lifecycle tool. */
export function buildSubagentTool(projectRoot: string, sessionId: string) {
	return {
		name: 'subagent',
		tool: tool({
			description:
				'Manage sub-agents. Actions: delegate starts asynchronous work; list shows all lifecycle results; status inspects one agent including context-window usage; read returns a bounded overview of recent tool calls; message marks the child active and sends a queued or interrupting follow-up; compact queues /compact after the child is idle; stop cancels; retry restarts a failed run. For delegate, omit reuseSessionId for fresh parallel work and use it only for related continuation. Delegated work is owned by the child. Results are delivered automatically when ready. The main agent must not sleep, wait, or repeatedly call list, status, or read to poll a running child; continue other work or end the turn instead.',
			inputSchema: subagentInputSchema,
			async execute(input) {
				switch (input.action) {
					case 'delegate': {
						const agent = requiredText(input, 'agent');
						const task = requiredText(input, 'task');
						if (!agent || !task) {
							return {
								ok: false,
								error: 'delegate requires non-empty agent and task',
							};
						}
						const cfg = await loadConfig(projectRoot);
						const db = await getDb(cfg.projectRoot);
						const sessionRows = await db
							.select({ agent: sessions.agent })
							.from(sessions)
							.where(eq(sessions.id, sessionId))
							.limit(1);
						const result = await spawnSubagent({
							db,
							cfg,
							parentSessionId: sessionId,
							parentAgent: sessionRows[0]?.agent ?? 'unknown',
							agent,
							task,
							context: input.context,
							reuseSessionId: input.reuseSessionId,
						});
						if (!result.ok) return { ok: false, error: result.error };
						return {
							ok: true,
							subagentId: result.subagentId,
							childSessionId: result.childSessionId,
							agent: result.agent,
							status: 'running',
							note: 'Task delegated. Do not sleep or poll; continue unrelated work or end the turn. The result will arrive automatically when ready.',
						};
					}
					case 'list': {
						const db = await getDb(projectRoot);
						const records = await listSubagentsForSession(db, sessionId);
						const filtered = input.status
							? records.filter((record) => record.status === input.status)
							: records;
						const seen = filtered.filter(
							(record) =>
								record.status !== 'running' &&
								!record.reported &&
								record.summary,
						);
						if (seen.length) {
							await markSubagentsReported(
								db,
								seen.map((record) => record.id),
							);
						}
						return {
							ok: true,
							subagents: filtered.map((record) => ({
								id: record.id,
								agent: record.agent,
								task: record.task,
								status: record.status,
								summary: record.summary ?? undefined,
								canRetry: record.status === 'failed',
								canMessage: record.status !== 'cancelled',
								childSessionId: record.childSessionId,
							})),
						};
					}
					case 'status': {
						const subagentId = requiredText(input, 'subagentId');
						if (!subagentId) {
							return {
								ok: false,
								error: 'status requires a non-empty subagentId',
							};
						}
						const db = await getDb(projectRoot);
						return getSubagentStatus({
							db,
							parentSessionId: sessionId,
							subagentId,
						});
					}
					case 'read': {
						const subagentId = requiredText(input, 'subagentId');
						if (!subagentId) {
							return {
								ok: false,
								error: 'read requires a non-empty subagentId',
							};
						}
						const db = await getDb(projectRoot);
						return readSubagentActivity({
							db,
							parentSessionId: sessionId,
							subagentId,
							limit: input.limit ?? 5,
						});
					}
					case 'message': {
						const subagentId = requiredText(input, 'subagentId');
						const message = requiredText(input, 'message');
						if (!subagentId || !message) {
							return {
								ok: false,
								error: 'message requires non-empty subagentId and message',
							};
						}
						const cfg = await loadConfig(projectRoot);
						const db = await getDb(cfg.projectRoot);
						const result = await messageSubagent({
							db,
							cfg,
							parentSessionId: sessionId,
							subagentId,
							message,
							delivery: input.delivery ?? 'queue',
						});
						if (!result.ok) return { ok: false, error: result.error };
						return {
							ok: true,
							subagentId: result.subagentId,
							childSessionId: result.childSessionId,
							agent: result.agent,
							messageId: result.messageId,
							delivery: result.delivery,
							preemptedMessageId: result.preemptedMessageId,
							status: 'running',
							note:
								result.delivery === 'interrupt'
									? 'Sub-agent is active again; current work was preempted and the result arrives automatically.'
									: 'Sub-agent is active again; follow-up queued and the result arrives automatically.',
						};
					}
					case 'compact': {
						const subagentId = requiredText(input, 'subagentId');
						if (!subagentId) {
							return {
								ok: false,
								error: 'compact requires a non-empty subagentId',
							};
						}
						const cfg = await loadConfig(projectRoot);
						const db = await getDb(cfg.projectRoot);
						const result = await compactSubagent({
							db,
							cfg,
							parentSessionId: sessionId,
							subagentId,
						});
						if (!result.ok) return result;
						return {
							...result,
							note: 'Compaction queued in the idle child session.',
						};
					}
					case 'stop': {
						const subagentId = requiredText(input, 'subagentId');
						if (!subagentId) {
							return {
								ok: false,
								error: 'stop requires a non-empty subagentId',
							};
						}
						const db = await getDb(projectRoot);
						const result = await stopSubagent({
							db,
							parentSessionId: sessionId,
							subagentId,
						});
						if (!result.ok) return { ok: false, error: result.error };
						return {
							...result,
							status: 'cancelled',
							note: 'Sub-agent stopped and queued follow-ups cleared.',
						};
					}
					case 'retry': {
						const subagentId = requiredText(input, 'subagentId');
						if (!subagentId) {
							return {
								ok: false,
								error: 'retry requires a non-empty subagentId',
							};
						}
						const cfg = await loadConfig(projectRoot);
						const db = await getDb(cfg.projectRoot);
						const result = await retrySubagent({
							db,
							cfg,
							parentSessionId: sessionId,
							subagentId,
						});
						if (!result.ok) return { ok: false, error: result.error };
						return {
							ok: true,
							subagentId: result.subagentId,
							childSessionId: result.childSessionId,
							agent: result.agent,
							messageId: result.messageId,
							status: 'running',
							note: 'Retry queued; the result arrives automatically.',
						};
					}
				}
			},
		}),
	};
}

/** Builds the singleton sub-agent tool list used by runner setup. */
export function buildSubagentTools(projectRoot: string, sessionId: string) {
	return [buildSubagentTool(projectRoot, sessionId)];
}
