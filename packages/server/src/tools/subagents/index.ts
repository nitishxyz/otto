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
			'Child session id of a previous delegation to the SAME agent. The new task is dispatched into that session so prior context (explored files, changes) carries over. Use for related/continuation tasks; omit for unrelated work.',
		),
});

export function buildDelegateTaskTool(projectRoot: string, sessionId: string) {
	return {
		name: 'delegate_task',
		tool: tool({
			description:
				'Delegate a bounded task to another configured agent. Delegation transfers ownership of that task to the sub-agent: do not do the same work yourself unless the sub-agent fails, the user asks for independent verification, or your task explicitly says to work in parallel. The sub-agent runs asynchronously in its own session while you continue unrelated work. Returns immediately with the child session id. Results are delivered automatically after the current parent turn ends. Do not poll for completion: if no unrelated work remains, end the current turn so delivery can occur.',
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
					note: 'Task ownership transferred to the sub-agent. Continue only unrelated work. Do not call list_subagents to poll: automatic result delivery requires this parent turn to end, so end it now if no unrelated work remains.',
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
				'List sub-agents spawned from this session with their status and result summaries. Use for an explicit status review or after automatic delivery, not to poll a running sub-agent. If a listed sub-agent is still running, do not check again in this turn; end the turn so its result can be delivered automatically.',
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
});

export function buildMessageSubagentTool(
	projectRoot: string,
	sessionId: string,
) {
	return {
		name: 'message_subagent',
		tool: tool({
			description:
				'Send a follow-up message to a sub-agent session. If it is running, the message queues behind the current run; otherwise it resumes with full prior context. Use this for clarifications or incremental follow-up work instead of re-delegating from scratch.',
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
					note: 'Follow-up queued/sent. The sub-agent result arrives automatically when it finishes.',
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
		buildRetrySubagentTool(projectRoot, sessionId),
	];
}
