import { asc, eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { subagents } from '@ottocode/database/schema';
import type { SubagentRecord } from './types.ts';

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
 * seen their summaries via subagent action=list, so the idle hook does not deliver
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
