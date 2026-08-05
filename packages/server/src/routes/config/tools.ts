import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { getProjectToolCatalog } from '../../runtime/tools/catalog.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

const getToolsQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const toolDetailSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	category: z.enum([
		'first_class',
		'loadable',
		'core',
		'filesystem',
		'search',
		'editing',
		'shell',
		'git',
		'web',
		'mcp',
		'skill',
		'research',
		'orchestration',
		'custom',
		'other',
	]),
	source: z.enum(['builtin', 'mcp', 'skill', 'custom']),
	activation: z.enum(['first_class', 'loadable', 'mcp']).optional(),
	required: z.boolean().optional(),
	risky: z.boolean().optional(),
	available: z.boolean(),
});

const getToolsResponseSchema = z.object({
	tools: z.array(toolDetailSchema),
});

export function registerToolsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/tools',
			tags: ['config'],
			operationId: 'getConfigTools',
			summary: 'Get available tools for agent configuration',
			request: { query: getToolsQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: getToolsResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				return c.json({ tools: await getProjectToolCatalog(projectRoot) });
			} catch (error) {
				logger.error('Failed to get config tools', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
