import { tool } from 'ai';
import { z } from 'zod/v3';
import { eq } from 'drizzle-orm';
import { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';
import { getRunnerState } from '../../runtime/session/queue.ts';

const inputSchema = z.object({
	message: z
		.string()
		.min(1)
		.describe(
			'Continuation message for the main session agent: remaining tasks, verification asks, or error recovery instructions',
		),
});

/**
 * Otto-only tool: enqueues a continuation run into the parent main session.
 */
export function buildEnqueueSessionMessageTool(
	projectRoot: string,
	targetSessionId: string,
) {
	return {
		name: 'enqueue_session_message',
		tool: tool({
			description:
				'Enqueue a continuation message into the main session you supervise. The main agent will run with this message as input. Use sparingly: only when work remains, a claim needs confirmation, or an error needs a retry.',
			inputSchema,
			async execute(input) {
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);
				const rows = await db
					.select()
					.from(sessions)
					.where(eq(sessions.id, targetSessionId))
					.limit(1);
				const target = rows[0];
				if (!target) {
					return { ok: false, error: 'Main session not found.' };
				}
				const state = getRunnerState(targetSessionId);
				if (state && (state.running || state.queue.length > 0)) {
					return {
						ok: false,
						error:
							'Main session is currently running; it will pick up state on its own. Do not enqueue now.',
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
