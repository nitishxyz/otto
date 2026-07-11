import type { DB } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { and, eq } from 'drizzle-orm';
import { getRunnerState } from './queue.ts';

export interface SessionParentRelation {
	id: string;
	parentSessionId: string | null;
}

/**
 * Expands live child runner ids to include every ancestor session.
 */
export function collectRunningSessionTreeIds(
	relations: SessionParentRelation[],
	runningSessionIds: Iterable<string>,
): Set<string> {
	const parentById = new Map(
		relations.map((relation) => [relation.id, relation.parentSessionId]),
	);
	const runningTreeIds = new Set<string>();

	for (const runningSessionId of runningSessionIds) {
		const visited = new Set<string>();
		let sessionId: string | null = runningSessionId;
		while (sessionId && !visited.has(sessionId)) {
			visited.add(sessionId);
			runningTreeIds.add(sessionId);
			sessionId = parentById.get(sessionId) ?? null;
		}
	}

	return runningTreeIds;
}

/**
 * Returns live sub-agent sessions and all of their ancestors. Persisted
 * sub-agent statuses are deliberately ignored because they can survive a
 * server restart after the corresponding runner has stopped.
 */
export async function getRunningSessionTreeIds(
	db: DB,
	projectRoot?: string,
): Promise<Set<string>> {
	const relations = await db
		.select({
			id: sessions.id,
			parentSessionId: sessions.parentSessionId,
		})
		.from(sessions)
		.where(
			projectRoot
				? and(
						eq(sessions.projectPath, projectRoot),
						eq(sessions.sessionType, 'subagent'),
					)
				: eq(sessions.sessionType, 'subagent'),
		);
	const runningIds = relations
		.filter((relation) => getRunnerState(relation.id)?.running === true)
		.map((relation) => relation.id);
	return collectRunningSessionTreeIds(relations, runningIds);
}

/** Returns whether a session has a live sub-agent descendant runner. */
export async function hasRunningSubagentDescendant(
	db: DB,
	sessionId: string,
): Promise<boolean> {
	return (await getRunningSessionTreeIds(db)).has(sessionId);
}
