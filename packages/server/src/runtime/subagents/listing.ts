import { and, asc, eq, ne } from 'drizzle-orm';
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
 * the same results again. When full records are passed, only the exact
 * version that was seen is acknowledged (compare-and-set), so a newer result
 * produced concurrently is still delivered. Running records are never marked.
 */
export async function markSubagentsReported(
	db: DB,
	seen: Array<string | Pick<SubagentRecord, 'id' | 'status' | 'updatedAt'>>,
): Promise<void> {
	for (const item of seen) {
		if (typeof item === 'string') {
			db.update(subagents)
				.set({
					reported: true,
					deliveryState: 'delivered',
					deliveryKey: 'subagent-list',
				})
				.where(and(eq(subagents.id, item), ne(subagents.status, 'running')))
				.run();
			continue;
		}
		if (item.status === 'running') continue;
		db.update(subagents)
			.set({
				reported: true,
				deliveryState: 'delivered',
				deliveryKey: 'subagent-list',
			})
			.where(
				and(
					eq(subagents.id, item.id),
					eq(subagents.status, item.status),
					eq(subagents.updatedAt, item.updatedAt),
				),
			)
			.run();
	}
}
