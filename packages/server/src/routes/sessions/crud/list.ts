import { z } from '@hono/zod-openapi';
import { sessions } from '@ottocode/database/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { getRunningSessionTreeIds } from '../../../runtime/session/working.ts';
import { resolveRequestProject } from '../../project-context.ts';
import {
	attachSessionCostSummary,
	getSessionCostSummaries,
	getSessionFileStats,
	normalizeSessionRow,
} from '../service.ts';
import { listSessionsQuerySchema, sessionSchema } from './schemas.ts';

export function registerListSessionsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions',
			tags: ['sessions'],
			operationId: 'listSessions',
			summary: 'List sessions',
			request: { query: listSessionsQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: z.object({
								items: z.array(sessionSchema),
								hasMore: z.boolean(),
								nextOffset: z.number().int().nullable(),
							}),
						},
					},
				},
			},
		},
		async (c) => {
			const limit = Math.min(
				Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1),
				200,
			);
			const offset = Math.max(
				parseInt(c.req.query('offset') || '0', 10) || 0,
				0,
			);
			const sessionTypeFilter = c.req.query('sessionType');
			const { cfg, db } = await resolveRequestProject(c);
			const rows = await db
				.select()
				.from(sessions)
				.where(
					sessionTypeFilter === 'looper'
						? and(
								eq(sessions.projectPath, cfg.projectRoot),
								eq(sessions.sessionType, 'looper'),
							)
						: and(
								eq(sessions.projectPath, cfg.projectRoot),
								ne(sessions.sessionType, 'research'),
								ne(sessions.sessionType, 'btw'),
								ne(sessions.sessionType, 'subagent'),
								ne(sessions.sessionType, 'looper'),
							),
				)
				.orderBy(
					desc(sql`${sessions.pinnedAt} IS NOT NULL`),
					desc(sessions.lastActiveAt),
					desc(sessions.createdAt),
				)
				.limit(limit + 1)
				.offset(offset);
			const hasMore = rows.length > limit;
			const page = hasMore ? rows.slice(0, limit) : rows;
			const [fileStats, costSummaries, runningTreeIds] = await Promise.all([
				getSessionFileStats(db, page),
				getSessionCostSummaries(db, page),
				getRunningSessionTreeIds(db, cfg.projectRoot),
			]);
			const normalized = page.map((row) => {
				const normalizedSession = normalizeSessionRow(row, {
					includeRunning: true,
				});
				const sessionWithRunningDescendants = runningTreeIds.has(row.id)
					? { ...normalizedSession, isRunning: true }
					: normalizedSession;
				const stats = fileStats.get(row.id);
				const sessionWithStats =
					stats && stats.changedFiles > 0
						? { ...sessionWithRunningDescendants, fileStats: stats }
						: sessionWithRunningDescendants;
				return attachSessionCostSummary(
					sessionWithStats,
					costSummaries.get(row.id),
				);
			});
			return c.json({
				items: normalized,
				hasMore,
				nextOffset: hasMore ? offset + limit : null,
			});
		},
	);
}
