import type { DB } from '@ottocode/database';
import { hasRunningSubagentDescendant } from '../../session/working.ts';

/** Computes live descendant activity using the same project scope as the run. */
export async function hasScopedRunningSubagentDescendant(
	db: DB,
	sessionId: string,
	projectRoot: string,
): Promise<boolean> {
	return hasRunningSubagentDescendant(db, sessionId, projectRoot);
}
