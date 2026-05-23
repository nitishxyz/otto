import type { Hono } from 'hono';
import { loadConfig } from '@ottocode/sdk';
import type { EmbeddedAppConfig } from '../../index.ts';
import { logger } from '@ottocode/sdk';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { discoverAllAgents, getDefault } from './utils.ts';
import { openApiRoute } from '../../openapi/route.ts';

export function registerAgentsRoute(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/agents',
			tags: ['config'],
			operationId: 'getAgents',
			summary: 'Get available agents',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									agents: {
										type: 'array',
										items: {
											type: 'string',
										},
									},
									default: {
										type: 'string',
									},
								},
								required: ['agents', 'default'],
							},
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
