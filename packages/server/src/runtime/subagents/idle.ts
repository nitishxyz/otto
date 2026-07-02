import { loadConfig, logger } from '@ottocode/sdk';
import { getDb } from '@ottocode/database';
import { and, desc, eq } from 'drizzle-orm';
import { messages } from '@ottocode/database/schema';
import { getSessionById } from '../session/manager.ts';
import { toErrorMessage } from '../errors/handling.ts';
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
	return (
		last.isAborted === true ||
		(last.isAborted !== false && last.finishReason === 'abort')
	);
}

/**
 * Runs whenever a session's run queue drains. Drives sub-agent result
 * reporting and looper wake-ups.
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

		// A user hard-stop means stop: no result reporting, no looper wake-up.
		// Anything pending is delivered after the next user-initiated run.
		if (await wasLastRunAbortedByUser(db, sessionId)) {
			const { resetLooperStallState } = await import('../looper/service.ts');
			resetLooperStallState(sessionId);
			logger.info('[idle] last run aborted by user; skipping looper/report', {
				sessionId,
			});
			return;
		}

		const reported = await reportFinishedSubagents(db, cfg, sessionId);
		if (reported) return;

		// Looper sessions receive sub-agent results like any parent, but never
		// wake another looper for themselves (no self-supervision loop).
		if (sessionType === 'looper') return;

		const { maybeWakeLooper } = await import('../looper/service.ts');
		await maybeWakeLooper({ db, cfg, session });
	} catch (error) {
		logger.warn('[idle] session idle hook failed', {
			sessionId,
			error: toErrorMessage(error),
		});
	}
}
