import { getDb } from '@ottocode/database';
import { messages } from '@ottocode/database/schema';
import { loadConfig, logger } from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import { publishAssistantMessageError } from '../../errors/assistant-message-error.ts';
import { toErrorLogPayload, toErrorPayload } from '../../errors/handling.ts';
import type { RunOpts } from '../../session/queue.ts';

export async function markUnhandledAssistantRunFailure(
	opts: RunOpts,
	err: unknown,
) {
	const payload = toErrorPayload(err);
	const message = payload.message || 'Assistant run failed before streaming';

	try {
		const cfg = await loadConfig(opts.projectRoot);
		const db = await getDb(cfg.projectRoot);
		const existing = await db
			.select({ status: messages.status })
			.from(messages)
			.where(eq(messages.id, opts.assistantMessageId))
			.limit(1);

		if (existing[0]?.status && existing[0].status !== 'pending') {
			return;
		}

		await publishAssistantMessageError({
			db,
			opts,
			error: {
				message,
				type: payload.type,
				details: payload.details,
				isAborted: false,
			},
			partIndex: 0,
		});
	} catch (failure) {
		logger.warn('[agent] failed to mark assistant run failure', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			error: toErrorLogPayload(failure),
			originalError: toErrorLogPayload(err),
		});
	}
}
