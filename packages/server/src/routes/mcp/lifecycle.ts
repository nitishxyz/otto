import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import { startMCPServer, stopMCPServer, testMCPServer } from './service.ts';
import { copilotMCPOAuthStore, copilotMCPSessions } from './state.ts';

export function registerMCPLifecycleRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/mcp/servers/{name}/start',
			tags: ['mcp'],
			operationId: 'startMCPServer',
			summary: 'Start an MCP server',
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
									name: {
										type: 'string',
									},
									connected: {
										type: 'boolean',
									},
									tools: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												name: {
													type: 'string',
												},
												description: {
													type: 'string',
												},
											},
										},
									},
									authRequired: {
										type: 'boolean',
									},
									authType: {
										type: 'string',
									},
									sessionId: {
										type: 'string',
									},
									userCode: {
										type: 'string',
									},
									verificationUri: {
										type: 'string',
									},
									interval: {
										type: 'integer',
									},
									authUrl: {
										type: 'string',
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
			const result = await startMCPServer({
				name: c.req.param('name'),
				oAuthStore: copilotMCPOAuthStore,
				sessions: copilotMCPSessions,
			});
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/mcp/servers/{name}/stop',
			tags: ['mcp'],
			operationId: 'stopMCPServer',
			summary: 'Stop an MCP server',
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
			const result = await stopMCPServer(c.req.param('name'));
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/mcp/servers/{name}/test',
			tags: ['mcp'],
			operationId: 'testMCPServer',
			summary: 'Test connection to an MCP server',
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
									name: {
										type: 'string',
									},
									tools: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												name: {
													type: 'string',
												},
												description: {
													type: 'string',
												},
											},
										},
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
			const result = await testMCPServer(c.req.param('name'));
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);
}
