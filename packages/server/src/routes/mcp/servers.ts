import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import { addMCPServer, listMCPServers, removeMCPServer } from './service.ts';

export function registerMCPServerConfigRoutes(app: Hono) {
	openApiRoute(
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
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									servers: {
										type: 'array',
										items: {
											$ref: '#/components/schemas/MCPServer',
										},
									},
								},
								required: ['servers'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			return c.json({ servers: await listMCPServers() });
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/mcp/servers',
			tags: ['mcp'],
			operationId: 'addMCPServer',
			summary: 'Add a new MCP server',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								name: {
									type: 'string',
								},
								transport: {
									type: 'string',
									enum: ['stdio', 'http', 'sse'],
									default: 'stdio',
								},
								command: {
									type: 'string',
								},
								args: {
									type: 'array',
									items: {
										type: 'string',
									},
								},
								env: {
									type: 'object',
									additionalProperties: {
										type: 'string',
									},
								},
								url: {
									type: 'string',
								},
								headers: {
									type: 'object',
									additionalProperties: {
										type: 'string',
									},
								},
								oauth: {
									type: 'object',
								},
								scope: {
									type: 'string',
									enum: ['global', 'project'],
									default: 'global',
								},
							},
							required: ['name'],
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									ok: {
										type: 'boolean',
									},
									error: {
										type: 'string',
									},
								},
								required: ['ok'],
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			const result = await addMCPServer(await c.req.json());
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);

	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/mcp/servers/{name}',
			tags: ['mcp'],
			operationId: 'removeMCPServer',
			summary: 'Remove an MCP server',
			parameters: [
				{
					in: 'path',
					name: 'name',
					required: true,
					schema: {
						type: 'string',
					},
					description: 'MCP server name',
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
									ok: {
										type: 'boolean',
									},
									error: {
										type: 'string',
									},
								},
								required: ['ok'],
							},
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			const result = await removeMCPServer(c.req.param('name'));
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);
}
