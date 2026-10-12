import type { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { and, asc, eq, gt } from 'drizzle-orm';

type Db = Awaited<ReturnType<typeof getDb>>;
export type SessionMessageRow = typeof messages.$inferSelect;
export type SessionPartRow = typeof messageParts.$inferSelect;

export type CheckpointBoundary = {
	/** Message displaying the checkpoint summary. */
	summaryMessageId: string | null;
	/** Last message summarized by the checkpoint. */
	throughMessageId: string | null;
};

/** Session messages in canonical order: per-session sequence, then createdAt. */
export async function loadSessionMessages(
	db: Db,
	sessionId: string,
): Promise<SessionMessageRow[]> {
	return db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(asc(messages.sequence), asc(messages.createdAt));
}

/**
 * Parts of a session's messages in one query, grouped by message id and
 * ordered by index. `afterSequence` limits loading to messages after it.
 */
export async function loadSessionPartsByMessageId(
	db: Db,
	sessionId: string,
	afterSequence?: number | null,
): Promise<Map<string, SessionPartRow[]>> {
	const sessionFilter = eq(messages.sessionId, sessionId);
	const rows = await db
		.select({ part: messageParts })
		.from(messageParts)
		.innerJoin(messages, eq(messages.id, messageParts.messageId))
		.where(
			typeof afterSequence === 'number'
				? and(sessionFilter, gt(messages.sequence, afterSequence))
				: sessionFilter,
		)
		.orderBy(asc(messageParts.messageId), asc(messageParts.index));
	const grouped = new Map<string, SessionPartRow[]>();
	for (const { part } of rows) {
		const existing = grouped.get(part.messageId);
		if (existing) existing.push(part);
		else grouped.set(part.messageId, [part]);
	}
	return grouped;
}

export async function readCheckpointBoundary(
	db: Db,
	sessionId: string,
): Promise<
	CheckpointBoundary & {
		contextSummary: string | null;
		projectPath: string | null;
	}
> {
	const rows = await db
		.select({
			contextSummary: sessions.contextSummary,
			summaryMessageId: sessions.compactionMessageId,
			throughMessageId: sessions.compactionThroughMessageId,
			projectPath: sessions.projectPath,
		})
		.from(sessions)
		.where(eq(sessions.id, sessionId))
		.limit(1);
	return {
		contextSummary: rows[0]?.contextSummary ?? null,
		summaryMessageId: rows[0]?.summaryMessageId ?? null,
		throughMessageId: rows[0]?.throughMessageId ?? null,
		projectPath: rows[0]?.projectPath ?? null,
	};
}

/**
 * Messages after the checkpoint's summarized-through boundary, excluding the
 * summary message itself. Legacy checkpoints without a separate boundary use
 * the summary message as the boundary.
 */
export function sliceAfterCheckpoint<T extends { id: string }>(
	rows: T[],
	boundary: CheckpointBoundary,
): T[] {
	return splitAtCheckpoint(rows, boundary).after;
}

/** Like sliceAfterCheckpoint, also returning the boundary row if found. */
export function splitAtCheckpoint<T extends { id: string }>(
	rows: T[],
	boundary: CheckpointBoundary,
): { after: T[]; boundaryRow?: T } {
	const boundaryId = boundary.throughMessageId ?? boundary.summaryMessageId;
	if (!boundaryId) return { after: rows };
	const index = rows.findIndex((row) => row.id === boundaryId);
	const after = index >= 0 ? rows.slice(index + 1) : rows;
	const summaryId = boundary.summaryMessageId;
	return {
		after: summaryId ? after.filter((row) => row.id !== summaryId) : after,
		boundaryRow: index >= 0 ? rows[index] : undefined,
	};
}
