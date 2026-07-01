import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { basename } from 'node:path';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

const cwdResponseSchema = z.object({
	cwd: z.string(),
	dirName: z.string(),
});

export function registerCwdRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/cwd',
			tags: ['config'],
			operationId: 'getCwd',
			summary: 'Get current working directory info',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: cwdResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const cwd = await resolveRequestProjectRoot(c);
				const dirName = basename(cwd);
				return c.json({
					cwd,
					dirName,
				});
			} catch (error) {
				logger.error('Failed to get current working directory', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
