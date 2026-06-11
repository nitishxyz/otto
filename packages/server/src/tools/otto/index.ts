import { tool } from 'ai';
import { z } from 'zod/v3';
import { eq } from 'drizzle-orm';
import { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';
import { getRunnerState } from '../../runtime/session/queue.ts';

/**
 * Otto-only tool: enqueues a continuation run into a worker session.
 * When `defaultTargetSessionId` is provided (legacy otto-supervises-parent
 * sessions), the sessionId input may be omitted.
 */
export function buildEnqueueSessionMessageTool(
	projectRoot: string,
	defaultTargetSessionId?: string,
) {
	const inputSchema = z.object({
		sessionId: z
			.string()
			.optional()
			.describe(
				'Target worker session id. Defaults to the supervised session when omitted.',
			),
		message: z
			.string()
			.min(1)
			.describe(
				'Continuation message for the worker session agent: remaining work, verification asks, or error recovery instructions',
			),
	});

	return {
		name: 'enqueue_session_message',
		tool: tool({
			description:
				'Enqueue a continuation message into a worker session you orchestrate. The session agent will run with this message as input. Use sparingly: only when work remains, a claim needs confirmation, or an error needs a retry.',
			inputSchema,
			async execute(input) {
				const targetSessionId = input.sessionId ?? defaultTargetSessionId;
				if (!targetSessionId) {
					return {
						ok: false,
						error: 'No target session: pass sessionId.',
					};
				}
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);
				const rows = await db
					.select()
					.from(sessions)
					.where(eq(sessions.id, targetSessionId))
					.limit(1);
				const target = rows[0];
				if (!target) {
					return { ok: false, error: 'Target session not found.' };
				}
				const state = getRunnerState(targetSessionId);
				if (state && (state.running || state.queue.length > 0)) {
					return {
						ok: false,
						error:
							'Target session is currently running; it will pick up state on its own. Do not enqueue now.',
					};
				}
				const content = input.message.trimStart().startsWith('[otto]')
					? input.message
					: `[otto] ${input.message}`;
				const { dispatchAssistantMessage } = await import(
					'../../runtime/message/service.ts'
				);
				const result = await dispatchAssistantMessage({
					cfg,
					db,
					session: target,
					agent: target.agent,
					provider: target.provider as Parameters<
						typeof dispatchAssistantMessage
					>[0]['provider'],
					model: target.model,
					content,
				});
				return {
					ok: true,
					sessionId: targetSessionId,
					assistantMessageId: result.assistantMessageId,
				};
			},
		}),
	};
}
