import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { toErrorMessage } from '../../runtime/errors/handling.ts';
import {
	forgetProjects,
	listProjects,
	touchProject,
} from '../../runtime/projects/registry.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import { loadProjectDb } from '../sessions/service.ts';
import {
	aggregateProject,
	emptyAggregate,
	mergeAggregate,
} from './aggregate.ts';
import { resolveUsageRange } from './range.ts';
import { finalizeResponse } from './response.ts';
import {
	globalUsageStatsQuerySchema,
	usageStatsResponseSchema,
} from './schemas.ts';
import type { UsageStatsResponse } from './types.ts';

export function registerGlobalUsageRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/usage/stats/global',
			tags: ['usage'],
			operationId: 'getGlobalUsageStats',
			summary:
				'Get aggregated usage statistics across all known otto projects (fan-out across local registries)',
			request: {
				query: globalUsageStatsQuerySchema,
			},
			responses: {
				'200': {
					description: 'Aggregated usage stats across all registered projects',
					content: {
						'application/json': {
							schema: usageStatsResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const cwd = await resolveRequestProjectRoot(c);
				const { days } = c.req.valid('query');
				const range = resolveUsageRange(days);
				// Ensure the current project is registered even if usage/stats
				// hasn't been hit yet this session.
				try {
					const { cfg } = await loadProjectDb(cwd);
					await touchProject(cfg.projectRoot, cfg.paths.dbPath);
				} catch {
					// best effort
				}

				const registered = await listProjects();
				const known: typeof registered = [];
				const staleProjectRoots: string[] = [];
				for (const project of registered) {
					const dbFile = Bun.file(project.dbPath);
					if (await dbFile.exists()) {
						known.push(project);
					} else {
						staleProjectRoots.push(project.path);
					}
				}
				if (staleProjectRoots.length > 0) {
					await forgetProjects(staleProjectRoots);
				}

				const merged = emptyAggregate();
				const included: NonNullable<
					UsageStatsResponse['projects']
				>['included'] = [];
				const unavailable: NonNullable<
					UsageStatsResponse['projects']
				>['unavailable'] = [];

				const results = await Promise.allSettled(
					known.map(async (project) => {
						const out = await aggregateProject(project.path, range);
						return { project, out };
					}),
				);

				for (let index = 0; index < results.length; index += 1) {
					const result = results[index];
					const project = known[index];
					if (result.status === 'fulfilled') {
						mergeAggregate(merged, result.value.out.agg);
						included.push({
							id: project.id,
							name: project.name,
							path: project.path,
							lastSeenAt: project.lastSeenAt,
							messages: result.value.out.agg.totals.messages,
							notionalCostUsd: Number(
								result.value.out.agg.totals.notionalCostUsd.toFixed(6),
							),
						});
					} else {
						unavailable.push({
							id: project.id,
							name: project.name,
							path: project.path,
							reason: toErrorMessage(result.reason),
						});
					}
				}

				const label = `all projects (${included.length}${
					unavailable.length ? ` / ${included.length + unavailable.length}` : ''
				})`;
				const response = finalizeResponse(
					'global',
					label,
					merged,
					{
						included: included.sort(
							(a, b) => b.notionalCostUsd - a.notionalCostUsd,
						),
						unavailable,
					},
					range,
				);
				return c.json(response);
			} catch (error) {
				logger.error('Failed to compute global usage stats', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
