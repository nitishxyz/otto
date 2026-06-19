import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { aggregateProject } from './aggregate.ts';
import { finalizeResponse } from './response.ts';
import { usageStatsQuerySchema, usageStatsResponseSchema } from './schemas.ts';

export function registerProjectUsageRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/usage/stats',
			tags: ['usage'],
			operationId: 'getUsageStats',
			summary:
				'Get aggregated usage statistics for the current project (tokens, cost, by model/provider/day)',
			request: {
				query: usageStatsQuerySchema,
			},
			responses: {
				'200': {
					description: 'Aggregated usage stats',
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
				const projectRoot = c.req.query('project') || process.cwd();
				const { projectRoot: resolvedRoot, agg } =
					await aggregateProject(projectRoot);
				const response = finalizeResponse('project', resolvedRoot, agg);
				return c.json(response);
			} catch (error) {
				logger.error('Failed to compute usage stats', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
