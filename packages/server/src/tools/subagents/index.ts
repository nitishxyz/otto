import { tool } from 'ai';
import { z } from 'zod/v3';
import { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { loadConfig } from '@ottocode/sdk';
import {
	listSubagentsForSession,
	markSubagentsReported,
	messageSubagent,
	retrySubagent,
	spawnSubagent,
	stopSubagent,
} from '../../runtime/subagents/service.ts';

const delegateInputSchema = z.object({
	agent: z
		.string()
		.min(1)
		.describe('Name of the configured agent to delegate to'),
	task: z.string().min(1).describe('The task the sub-agent should complete'),
	context: z
		.string()
		.optional()
		.describe(
			'Relevant findings, file paths, and constraints the sub-agent needs',
		),
	reuseSessionId: z
		.string()
		.optional()
		.describe(
			'Child session id of a previous delegation to the SAME agent type. The new task is dispatched into that session so prior context (explored files, changes) carries over. Use for related/continuation tasks; omit for unrelated work or parallel work, which starts a fresh instance even when another instance of this agent type is running.',
		),
});

export function buildDelegateTaskTool(projectRoot: string, sessionId: string) {
	return {
		name: 'delegate_task',
		tool: tool({
			description:
				'Delegate a bounded task to another configured agent type. Each call without reuseSessionId starts a fresh sub-agent instance, so independent tasks may run concurrently in multiple instances of the same agent type (for example, two separate plan delegations). Use reuseSessionId or message_subagent only for related continuation work that should retain an existing instance context; do not use them merely because that agent type is already running. Delegation transfers ownership of that task to the sub-agent: do not do the same work yourself unless the sub-agent fails, the user asks for independent verification, or your task explicitly says to work in parallel. The sub-agent runs asynchronously in its own session while you continue unrelated work. Returns immediately with the child session id. Results are delivered automatically at the next parent model step when possible, or in a continuation after the current turn ends. Do not poll for completion: continue unrelated work, and end the current turn if none remains.',
			inputSchema: delegateInputSchema,
			async execute(input) {
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);
				const sessionRows = await db
					.select({ agent: sessions.agent })
					.from(sessions)
					.where(eq(sessions.id, sessionId))
					.limit(1);
				const parentAgent = sessionRows[0]?.agent ?? 'unknown';
				const result = await spawnSubagent({
					db,
					cfg,
					parentSessionId: sessionId,
					parentAgent,
					agent: input.agent,
					task: input.task,
					context: input.context,
					reuseSessionId: input.reuseSessionId,
				});
				if (!result.ok) {
					return { ok: false, error: result.error };
				}
				return {
					ok: true,
					subagentId: result.subagentId,
					childSessionId: result.childSessionId,
					agent: result.agent,
					status: 'running',
					note: 'Task ownership transferred to the sub-agent. Continue only unrelated work. Do not call list_subagents to poll: the result will be injected at the next parent model step when possible, or delivered in a continuation after this turn ends.',
				};
			},
		}),
	};
}

const listInputSchema = z.object({
	status: z
		.enum(['running', 'completed', 'failed', 'cancelled'])
		.optional()
		.describe('Optionally filter by status'),
});

export function buildListSubagentsTool(projectRoot: string, sessionId: string) {
	return {
		name: 'list_subagents',
		tool: tool({
			description:
				'List sub-agents spawned from this session with their status and result summaries. Use for an explicit status review or after automatic delivery, not to poll a running sub-agent. If a listed sub-agent is still running, do not check again in this turn; continue unrelated work or end the turn and let its result be delivered automatically.',
			inputSchema: listInputSchema,
			async execute(input) {
				const db = await getDb(projectRoot);
				const records = await listSubagentsForSession(db, sessionId);
				const filtered = input.status
					? records.filter((r) => r.status === input.status)
					: records;
				// The agent has now seen these summaries; mark them reported so the
				// idle hook does not deliver the same results again.
				const seen = filtered.filter(
					(r) => r.status !== 'running' && !r.reported && r.summary,
				);
				if (seen.length) {
					await markSubagentsReported(
						db,
						seen.map((r) => r.id),
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
			},
		}),
	};
}

const messageInputSchema = z.object({
	subagentId: z
		.string()
		.min(1)
		.describe('Id of the sub-agent to follow up with (from list_subagents)'),
	message: z
		.string()
		.min(1)
		.describe('Follow-up question or task for the sub-agent'),
	delivery: z
		.enum(['queue', 'interrupt'])
		.optional()
		.default('queue')
		.describe(
			'queue waits behind the current turn; interrupt silently stops the current turn and delivers this message next',
		),
});

export function buildMessageSubagentTool(
	projectRoot: string,
	sessionId: string,
) {
	return {
		name: 'message_subagent',
		tool: tool({
			description:
				'Send a follow-up message to a sub-agent session with full prior context. delivery="queue" (default) waits behind a running turn. delivery="interrupt" silently stops the current turn and delivers the follow-up next; use it only when the current work must change immediately. Use this tool for clarifications or incremental follow-up work instead of re-delegating from scratch.',
			inputSchema: messageInputSchema,
			async execute(input) {
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);
				const result = await messageSubagent({
					db,
					cfg,
					parentSessionId: sessionId,
					subagentId: input.subagentId,
					message: input.message,
					delivery: input.delivery,
				});
				if (!result.ok) {
					return { ok: false, error: result.error };
				}
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
							? 'The current turn was preempted and the follow-up will run next. The result arrives automatically when it finishes.'
							: 'Follow-up queued. The sub-agent result arrives automatically when it finishes.',
				};
			},
		}),
	};
}

const stopInputSchema = z.object({
	subagentId: z
		.string()
		.min(1)
		.describe('Id of the running sub-agent to stop (from list_subagents)'),
});

export function buildStopSubagentTool(projectRoot: string, sessionId: string) {
	return {
		name: 'stop_subagent',
		tool: tool({
			description:
				'Stop one running sub-agent owned by this session. This aborts its current turn, clears queued follow-ups, and marks it cancelled. Use delegate_task to start fresh if work is needed later.',
			inputSchema: stopInputSchema,
			async execute(input) {
				const db = await getDb(projectRoot);
				const result = await stopSubagent({
					db,
					parentSessionId: sessionId,
					subagentId: input.subagentId,
				});
				if (!result.ok) return { ok: false, error: result.error };
				return {
					...result,
					status: 'cancelled',
					note: 'Sub-agent stopped. Its queued follow-ups were cleared.',
				};
			},
		}),
	};
}

const retryInputSchema = z.object({
	subagentId: z
		.string()
		.min(1)
		.describe('Id of the failed sub-agent to retry (from list_subagents)'),
});

export function buildRetrySubagentTool(projectRoot: string, sessionId: string) {
	return {
		name: 'retry_subagent',
		tool: tool({
			description:
				'Retry the latest failed assistant run inside a sub-agent session, equivalent to pressing Retry in the UI. Use this when list_subagents shows a failed sub-agent whose work should be attempted again with the same context.',
			inputSchema: retryInputSchema,
			async execute(input) {
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);
				const result = await retrySubagent({
					db,
					cfg,
					parentSessionId: sessionId,
					subagentId: input.subagentId,
				});
				if (!result.ok) {
					return { ok: false, error: result.error };
				}
				return {
					ok: true,
					subagentId: result.subagentId,
					childSessionId: result.childSessionId,
					agent: result.agent,
					messageId: result.messageId,
					status: 'running',
					note: 'Retry queued. The sub-agent result arrives automatically when it finishes.',
				};
			},
		}),
	};
}

export function buildSubagentTools(projectRoot: string, sessionId: string) {
	return [
		buildDelegateTaskTool(projectRoot, sessionId),
		buildListSubagentsTool(projectRoot, sessionId),
		buildMessageSubagentTool(projectRoot, sessionId),
		buildStopSubagentTool(projectRoot, sessionId),
		buildRetrySubagentTool(projectRoot, sessionId),
	];
}
