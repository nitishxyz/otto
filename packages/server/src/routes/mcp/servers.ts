import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import { addMCPServer, listMCPServers, removeMCPServer } from './service.ts';

const mcpServerSchema = z
	.object({
		name: z.string(),
		transport: z.enum(['stdio', 'http', 'sse']),
		command: z.string().optional(),
		args: z.array(z.string()),
		url: z.string().optional(),
		env: z.record(z.string(), z.string()).optional(),
		headers: z.record(z.string(), z.string()).optional(),
		disabled: z.boolean(),
		connected: z.boolean(),
		tools: z.array(z.string()),
		error: z.string().optional(),
		authRequired: z.boolean(),
		authenticated: z.boolean(),
		scope: z.enum(['global', 'project']),
		authType: z.string().optional(),
		sourceKind: z.enum(['user', 'plugin']).optional(),
		sourcePlugin: z.string().optional(),
		sourceLabel: z.string().optional(),
		managedByPlugin: z.boolean().optional(),
		overridesPlugin: z.string().optional(),
	})
	.passthrough()
	.openapi('MCPServer');

const listMCPServersResponseSchema = z.object({
	servers: z.array(mcpServerSchema),
});

const addMCPServerBodySchema = z.object({
	name: z.string(),
	transport: z.enum(['stdio', 'http', 'sse']).optional().default('stdio'),
	command: z.string().optional(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
	url: z.string().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	oauth: z.record(z.string(), z.unknown()).optional(),
	scope: z.enum(['global', 'project']).optional().default('global'),
});

const mcpServerActionResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});

const mcpServerErrorSchema = z.object({
	error: z.string(),
});

const mcpServerNameParamsSchema = z.object({
	name: z.string().openapi({
		param: { name: 'name', in: 'path' },
		description: 'MCP server name',
	}),
});

export function registerMCPServerConfigRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/mcp/servers',
			tags: ['mcp'],
			operationId: 'listMCPServers',
			summary: 'List configured MCP servers',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: listMCPServersResponseSchema },
					},
				},
			},
		},
		async (c) => {
			return c.json({
				servers: await listMCPServers(await resolveRequestProjectRoot(c)),
			});
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/mcp/servers',
			tags: ['mcp'],
			operationId: 'addMCPServer',
			summary: 'Add a new MCP server',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: addMCPServerBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: mcpServerActionResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: mcpServerErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const result = await addMCPServer(
				await c.req.json(),
				await resolveRequestProjectRoot(c),
			);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/mcp/servers/{name}',
			tags: ['mcp'],
			operationId: 'removeMCPServer',
			summary: 'Remove an MCP server',
			request: {
				params: mcpServerNameParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: mcpServerActionResponseSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: mcpServerErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const result = await removeMCPServer(
				c.req.param('name'),
				await resolveRequestProjectRoot(c),
			);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);
}
