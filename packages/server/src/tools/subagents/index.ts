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
});

export function buildDelegateTaskTool(projectRoot: string, sessionId: string) {
	return {
		name: 'delegate_task',
		tool: tool({
			description:
				'Delegate a bounded task to another configured agent. Delegation transfers ownership of that task to the sub-agent: do not do the same work yourself unless the sub-agent fails, the user asks for independent verification, or your task explicitly says to work in parallel. The sub-agent runs asynchronously in its own session while you continue unrelated work. Returns immediately with the child session id. You will receive the result automatically when it finishes, or you can poll with list_subagents.',
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
				});
				if (!result.ok) {
					return { ok: false, error: result.error };
				}
				return {
					ok: true,
					subagentId: result.subagentId,
					childSessionId: result.childSessionId,
					agent: result.agent,
					status: 'started',
					note: 'Task ownership transferred to the sub-agent. Do not perform the delegated task yourself unless it fails or the user explicitly requested independent verification. Continue unrelated work, or wait/check list_subagents.',
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
				'List sub-agents spawned from this session with their status and result summaries. Use this instead of remembering what you delegated.',
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
				'Send a follow-up message to a finished sub-agent. It resumes in the same session with full prior context, runs asynchronously, and reports back like the original delegation. Use this for clarifications or incremental follow-up work instead of re-delegating from scratch.',
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
					status: 'started',
					note: 'Follow-up sent. The sub-agent resumes with its prior context; the result arrives automatically when you go idle.',
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
	];
}
