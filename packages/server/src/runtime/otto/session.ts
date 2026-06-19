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
 * Returns the otto session that owns a goal, creating and binding one
 * (goals.ottoSessionId) when missing. Migrates legacy goals whose otto
 * session was a child of the supervised session.
 */
export async function ensureOttoSessionForGoal(
	db: DB,
	cfg: OttoConfig,
	goal: GoalRow,
): Promise<SessionRow | undefined> {
	if (goal.ottoSessionId) {
		const rows = await db
			.select()
			.from(sessions)
			.where(eq(sessions.id, goal.ottoSessionId))
			.limit(1);
		if (rows[0]?.sessionType === 'otto') return rows[0];
		if (rows[0]) {
			logger.warn('[otto] goal bound to non-otto session; rebinding', {
				goalId: goal.id,
				boundSessionId: rows[0].id,
				sessionType: rows[0].sessionType,
			});
		}
	}

	// Legacy binding: otto session created as a child of the supervised session.
	if (goal.sessionId) {
		const legacy = await db
			.select()
			.from(sessions)
			.where(
				and(
					eq(sessions.parentSessionId, goal.sessionId),
					eq(sessions.sessionType, 'otto'),
				),
			)
			.limit(1);
		if (legacy[0]) {
			await db
				.update(goals)
				.set({ ottoSessionId: legacy[0].id, updatedAt: Date.now() })
				.where(eq(goals.id, goal.id));
			return legacy[0];
		}
	}

	const created = await createOttoSession(db, cfg, {
		title: goal.title,
	});
	if (!created) return undefined;
	await db
		.update(goals)
		.set({ ottoSessionId: created.id, updatedAt: Date.now() })
		.where(eq(goals.id, goal.id));
	return created;
}

async function createOttoSession(
	db: DB,
	cfg: OttoConfig,
	opts: { title: string | null; parentSessionId?: string },
): Promise<SessionRow | undefined> {
	try {
		const agentCfg = await resolveAgentConfig(cfg.projectRoot, 'otto');
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
			agent: 'otto',
			provider: selection.provider,
			model: selection.model,
			title: opts.title,
			parentSessionId: opts.parentSessionId,
			sessionType: 'otto',
		});
	} catch (error) {
		logger.warn('[otto] failed to create otto session', {
			error: toErrorMessage(error),
		});
		return undefined;
	}
}
