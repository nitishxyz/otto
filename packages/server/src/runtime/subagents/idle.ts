import { loadConfig, logger } from '@ottocode/sdk';
import { getDb } from '@ottocode/database';
import { and, desc, eq } from 'drizzle-orm';
import { messages } from '@ottocode/database/schema';
import { getSessionById } from '../session/manager.ts';
import {
	finalizeSubagentForChildSession,
	reportFinishedSubagents,
} from './service.ts';

const SKIPPED_SESSION_TYPES = new Set(['research', 'btw']);

async function wasLastRunAbortedByUser(
	db: Awaited<ReturnType<typeof getDb>>,
	sessionId: string,
): Promise<boolean> {
	const rows = await db
		.select({
			isAborted: messages.isAborted,
			finishReason: messages.finishReason,
		})
		.from(messages)
		.where(
			and(eq(messages.sessionId, sessionId), eq(messages.role, 'assistant')),
		)
		.orderBy(desc(messages.createdAt))
		.limit(1);
	const last = rows[0];
	if (!last) return false;
	return last.isAborted === true || last.finishReason === 'abort';
}

/**
 * Runs whenever a session's run queue drains. Drives sub-agent result
 * reporting and otto wake-ups.
 */
export async function handleSessionIdle(
	sessionId: string,
	projectRoot: string,
): Promise<void> {
	try {
		const cfg = await loadConfig(projectRoot);
		const db = await getDb(cfg.projectRoot);
		const session = await getSessionById({ db, sessionId });
		if (!session) return;
		const sessionType = session.sessionType ?? 'main';
		if (SKIPPED_SESSION_TYPES.has(sessionType)) return;

		if (sessionType === 'subagent') {
			const record = await finalizeSubagentForChildSession(db, sessionId);
			if (record) {
				await reportFinishedSubagents(db, cfg, record.parentSessionId);
			}
			return;
		}

		// A user hard-stop means stop: no result reporting, no otto wake-up.
		// Anything pending is delivered after the next user-initiated run.
		if (await wasLastRunAbortedByUser(db, sessionId)) {
			const { resetOttoStallState } = await import('../otto/service.ts');
			resetOttoStallState(sessionId);
			logger.info('[idle] last run aborted by user; skipping otto/report', {
				sessionId,
			});
			return;
		}

		const reported = await reportFinishedSubagents(db, cfg, sessionId);
		if (reported) return;

		// Otto sessions receive sub-agent results like any parent, but never
		// wake another otto for themselves (no self-supervision loop).
		if (sessionType === 'otto') return;

		if (cfg.defaults.ottoEnabled === false) return;
		const { maybeWakeOtto } = await import('../otto/service.ts');
		await maybeWakeOtto({ db, cfg, session });
	} catch (error) {
		logger.warn('[idle] session idle hook failed', {
			sessionId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
