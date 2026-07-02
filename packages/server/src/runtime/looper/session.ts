import { and, eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { goals, sessions } from '@ottocode/database/schema';
import { hasConfiguredProvider, logger, type OttoConfig } from '@ottocode/sdk';
import { resolveAgentConfig } from '../agent/registry.ts';
import { toErrorMessage } from '../errors/handling.ts';
import { selectProviderAndModel } from '../provider/selection.ts';
import { createSession } from '../session/manager.ts';
import type { GoalRow, SessionRow } from './types.ts';

/**
 * Returns the looper session that owns a goal, creating and binding one
 * (goals.looperSessionId) when missing. Migrates legacy goals whose looper
 * session was a child of the supervised session.
 */
export async function ensureLooperSessionForGoal(
	db: DB,
	cfg: OttoConfig,
	goal: GoalRow,
): Promise<SessionRow | undefined> {
	if (goal.looperSessionId) {
		const rows = await db
			.select()
			.from(sessions)
			.where(eq(sessions.id, goal.looperSessionId))
			.limit(1);
		if (rows[0]?.sessionType === 'looper') return rows[0];
		if (rows[0]) {
			logger.warn('[looper] goal bound to non-looper session; rebinding', {
				goalId: goal.id,
				boundSessionId: rows[0].id,
				sessionType: rows[0].sessionType,
			});
		}
	}

	// Legacy binding: looper session created as a child of the supervised session.
	if (goal.sessionId) {
		const legacy = await db
			.select()
			.from(sessions)
			.where(
				and(
					eq(sessions.parentSessionId, goal.sessionId),
					eq(sessions.sessionType, 'looper'),
				),
			)
			.limit(1);
		if (legacy[0]) {
			await db
				.update(goals)
				.set({ looperSessionId: legacy[0].id, updatedAt: Date.now() })
				.where(eq(goals.id, goal.id));
			return legacy[0];
		}
	}

	const created = await createLooperSession(db, cfg, {
		title: goal.title,
	});
	if (!created) return undefined;
	await db
		.update(goals)
		.set({ looperSessionId: created.id, updatedAt: Date.now() })
		.where(eq(goals.id, goal.id));
	return created;
}

async function createLooperSession(
	db: DB,
	cfg: OttoConfig,
	opts: { title: string | null; parentSessionId?: string },
): Promise<SessionRow | undefined> {
	try {
		const agentCfg = await resolveAgentConfig(cfg.projectRoot, 'looper');
		const agentProviderDefault = hasConfiguredProvider(cfg, agentCfg.provider)
			? agentCfg.provider
			: cfg.defaults.provider;
		const agentModelDefault = agentCfg.model ?? cfg.defaults.model;
		const selection = await selectProviderAndModel({
			cfg,
			agentProviderDefault,
			agentModelDefault,
		});
		return await createSession({
			db,
			cfg,
			agent: 'looper',
			provider: selection.provider,
			model: selection.model,
			title: opts.title,
			parentSessionId: opts.parentSessionId,
			sessionType: 'looper',
		});
	} catch (error) {
		logger.warn('[looper] failed to create looper session', {
			error: toErrorMessage(error),
		});
		return undefined;
	}
}
