import { z } from '@hono/zod-openapi';
import { loadConfig, logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import type { EmbeddedAppConfig } from '../../index.ts';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	deleteAgentConfig,
	getAgentDetail,
	getAllAgentDetails,
	upsertAgentConfig,
} from '../../runtime/agent/config-management.ts';
import {
	BUILTIN_AGENT_DESCRIPTIONS,
	defaultToolConfigForAgent,
	isHiddenAgent,
	MAX_AGENT_DESCRIPTION_LENGTH,
	normalizeAgentDescription,
} from '../../runtime/agent/registry.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { discoverAllAgents, getDefault } from './utils.ts';

const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const agentParamsSchema = z.object({
	agent: z.string().openapi({
		param: { name: 'agent', in: 'path' },
		description: 'Agent name.',
	}),
});

const scopedProjectQuerySchema = projectQuerySchema.extend({
	scope: z
		.enum(['local', 'global'])
		.optional()
		.openapi({
			param: { name: 'scope', in: 'query' },
			description: 'Configuration scope. Defaults to local.',
		}),
});

const getAgentsResponseSchema = z.object({
	agents: z.array(z.string()),
	default: z.string(),
});

const agentToolGroupsSchema = z.object({
	firstClass: z.array(z.string()).optional(),
	loadable: z.array(z.string()).optional(),
});

const agentDetailSchema = z.object({
	name: z.string(),
	builtin: z.boolean(),
	custom: z.boolean(),
	source: z.enum(['builtin', 'local', 'global', 'merged', 'embedded']),
	prompt: z.string(),
	promptSource: z.string(),
	description: z.string().optional(),
	defaultDescription: z.string().optional(),
	toolConfig: agentToolGroupsSchema,
	defaultToolConfig: agentToolGroupsSchema,
	appendToolConfig: agentToolGroupsSchema,
	provider: z.string().optional(),
	model: z.string().optional(),
	editable: z.boolean(),
	hasLocalOverride: z.boolean(),
	hasGlobalOverride: z.boolean(),
});

const getAgentDetailsResponseSchema = z.object({
	agents: z.array(agentDetailSchema),
	default: z.string(),
});

const getAgentResponseSchema = z.object({
	agent: agentDetailSchema,
});

const upsertAgentBodySchema = z.object({
	scope: z.enum(['local', 'global']).optional(),
	prompt: z.string().optional(),
	promptStorage: z.enum(['file', 'inline']).optional(),
	description: z
		.string()
		.max(MAX_AGENT_DESCRIPTION_LENGTH)
		.nullable()
		.optional(),
	tools: agentToolGroupsSchema.optional(),
	appendTools: agentToolGroupsSchema.optional(),
	provider: z.string().nullable().optional(),
	model: z.string().nullable().optional(),
});

const deleteAgentResponseSchema = z.object({
	deleted: z.boolean(),
	builtin: z.boolean(),
	agent: agentDetailSchema.optional(),
});

function getEmbeddedConfig(c: unknown): EmbeddedAppConfig | undefined {
	return (
		c as {
			get?: (key: 'embeddedConfig') => EmbeddedAppConfig | undefined;
		}
	).get?.('embeddedConfig');
}

function embeddedToolConfig(value: unknown, name: string) {
	if (!value) return defaultToolConfigForAgent(name);
	if (typeof value !== 'object' || Array.isArray(value))
		return defaultToolConfigForAgent(name);
	return embeddedOptionalToolConfig(value);
}

function embeddedOptionalToolConfig(value: unknown) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const record = value as Record<string, unknown>;
	return {
		firstClass: Array.isArray(record.firstClass)
			? record.firstClass.filter(
					(item): item is string => typeof item === 'string',
				)
			: [],
		loadable: Array.isArray(record.loadable)
			? record.loadable.filter(
					(item): item is string => typeof item === 'string',
				)
			: [],
	};
}

function getEmbeddedAgentDetails(embeddedConfig: EmbeddedAppConfig) {
	const agentEntries = embeddedConfig.agents ?? {};
	const names = (
		Object.keys(agentEntries).length
			? Object.keys(agentEntries)
			: ['build', 'general', 'plan', 'research']
	).filter((name) => !isHiddenAgent(name));
	const defaultAgent = getDefault(
		embeddedConfig.agent,
		embeddedConfig.defaults?.agent,
		'general',
	);
	return {
		agents: names.sort().map((name) => {
			const entry = agentEntries[name];
			const toolConfig = embeddedToolConfig(entry?.tools, name);
			return {
				name,
				builtin: ['build', 'general', 'plan', 'research'].includes(name),
				custom: !['build', 'general', 'plan', 'research'].includes(name),
				source: entry ? ('local' as const) : ('embedded' as const),
				prompt: typeof entry?.prompt === 'string' ? entry.prompt : '',
				promptSource: entry?.prompt ? 'embedded:agents' : 'embedded:default',
				description:
					normalizeAgentDescription(entry?.description) ??
					BUILTIN_AGENT_DESCRIPTIONS[name],
				defaultDescription: BUILTIN_AGENT_DESCRIPTIONS[name],
				toolConfig,
				defaultToolConfig: defaultToolConfigForAgent(name),
				appendToolConfig: embeddedOptionalToolConfig(entry?.appendTools),
				provider: entry?.provider ?? embeddedConfig.provider,
				model: entry?.model ?? embeddedConfig.model,
				editable: false,
				hasLocalOverride: Boolean(entry),
				hasGlobalOverride: false,
			};
		}),
		default: defaultAgent,
	};
}

export function registerAgentsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/agents',
			tags: ['config'],
			operationId: 'getAgents',
			summary: 'Get available agents',
			request: { query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: getAgentsResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const embeddedConfig = getEmbeddedConfig(c);

				if (embeddedConfig) {
					const agents = (
						embeddedConfig.agents
							? Object.keys(embeddedConfig.agents)
							: ['general', 'build', 'plan', 'research']
					).filter((name) => !isHiddenAgent(name));
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

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/agents/details',
			tags: ['config'],
			operationId: 'getAgentDetails',
			summary: 'Get detailed available agents',
			request: { query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: getAgentDetailsResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const embeddedConfig = getEmbeddedConfig(c);
				if (embeddedConfig)
					return c.json(getEmbeddedAgentDetails(embeddedConfig));
				const projectRoot = c.req.query('project') || process.cwd();
				return c.json(await getAllAgentDetails(projectRoot));
			} catch (error) {
				logger.error('Failed to get agent details', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/agents/{agent}',
			tags: ['config'],
			operationId: 'getAgent',
			summary: 'Get one agent detail',
			request: { params: agentParamsSchema, query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: getAgentResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const agent = c.req.param('agent');
				return c.json({ agent: await getAgentDetail(projectRoot, agent) });
			} catch (error) {
				logger.error('Failed to get agent', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'put',
			path: '/v1/config/agents/{agent}',
			tags: ['config'],
			operationId: 'upsertAgent',
			summary: 'Create or update an agent config override',
			request: {
				params: agentParamsSchema,
				query: projectQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: upsertAgentBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: getAgentResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const body = upsertAgentBodySchema.parse(
					await c.req.json().catch(() => ({})),
				);
				const agent = await upsertAgentConfig({
					projectRoot,
					name: c.req.param('agent'),
					input: body,
				});
				return c.json({ agent });
			} catch (error) {
				logger.error('Failed to upsert agent', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/config/agents/{agent}',
			tags: ['config'],
			operationId: 'deleteAgent',
			summary: 'Delete a custom agent config or reset a built-in override',
			request: { params: agentParamsSchema, query: scopedProjectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: deleteAgentResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const scope = c.req.query('scope') === 'global' ? 'global' : 'local';
				return c.json(
					await deleteAgentConfig({
						projectRoot,
						name: c.req.param('agent'),
						scope,
					}),
				);
			} catch (error) {
				logger.error('Failed to delete agent', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
