import { z } from '@hono/zod-openapi';
import { loadConfig, logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import type { EmbeddedAppConfig } from '../../index.ts';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { discoverAllAgents, getDefault } from './utils.ts';

const getAgentsQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const getAgentsResponseSchema = z.object({
	agents: z.array(z.string()),
	default: z.string(),
});

export function registerAgentsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/agents',
			tags: ['config'],
			operationId: 'getAgents',
			summary: 'Get available agents',
			request: {
				query: getAgentsQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: getAgentsResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const embeddedConfig = (
					c as unknown as {
						get: (key: 'embeddedConfig') => EmbeddedAppConfig | undefined;
					}
				).get('embeddedConfig');

				if (embeddedConfig) {
					const agents = embeddedConfig.agents
						? Object.keys(embeddedConfig.agents)
						: ['general', 'build', 'plan', 'init', 'research'];
					return c.json({
						agents,
						default: getDefault(
							embeddedConfig.agent,
							embeddedConfig.defaults?.agent,
							'general',
						),
					});
				}

				const projectRoot = c.req.query('project') || process.cwd();
				const cfg = await loadConfig(projectRoot);

				const allAgents = await discoverAllAgents(cfg.projectRoot);

				return c.json({
					agents: allAgents,
					default: cfg.defaults.agent,
				});
			} catch (error) {
				logger.error('Failed to get agents', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
