import { and, eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { subagents } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { abortSession } from '../session/queue.ts';

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
