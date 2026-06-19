import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { listShares, loadProjectDb } from '../service.ts';
import { listSharesResponseSchema, projectQuerySchema } from './schemas.ts';

export function registerListSharesRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/shares',
			tags: ['sessions'],
			operationId: 'listShares',
			summary: 'List all shared sessions for a project',
			request: {
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: listSharesResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const projectRoot = c.req.query('project') || process.cwd();
			const { cfg, db } = await loadProjectDb(projectRoot);
			return c.json({ shares: await listShares(cfg, db) });
		},
	);
}
