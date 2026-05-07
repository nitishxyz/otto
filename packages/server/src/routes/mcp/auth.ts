import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import {
	completeMCPAuth,
	getMCPAuthStatus,
	initiateMCPAuth,
	revokeMCPAuth,
} from './service.ts';
import { copilotMCPOAuthStore, copilotMCPSessions } from './state.ts';

export function registerMCPAuthRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/mcp/servers/{name}/auth',
			tags: ['mcp'],
			operationId: 'initiateMCPAuth',
			summary: 'Initiate auth for an MCP server',
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
									authUrl: {
										type: 'string',
									},
									authType: {
										type: 'string',
									},
									authenticated: {
										type: 'boolean',
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
									message: {
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
			const result = await initiateMCPAuth({
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
			path: '/v1/mcp/servers/{name}/auth/callback',
			tags: ['mcp'],
			operationId: 'completeMCPAuth',
			summary: 'Complete MCP server auth callback',
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
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								code: {
									type: 'string',
								},
								sessionId: {
									type: 'string',
								},
							},
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
									status: {
										type: 'string',
										enum: ['complete', 'pending', 'error'],
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
			const result = await completeMCPAuth({
				name: c.req.param('name'),
				body: await c.req.json(),
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
			method: 'get',
			path: '/v1/mcp/servers/{name}/auth/status',
			tags: ['mcp'],
			operationId: 'getMCPAuthStatus',
			summary: 'Get auth status for an MCP server',
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
									authenticated: {
										type: 'boolean',
									},
									authType: {
										type: 'string',
									},
								},
								required: ['authenticated'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			return c.json(
				await getMCPAuthStatus({
					name: c.req.param('name'),
					oAuthStore: copilotMCPOAuthStore,
				}),
			);
		},
	);

	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/mcp/servers/{name}/auth',
			tags: ['mcp'],
			operationId: 'revokeMCPAuth',
			summary: 'Revoke auth for an MCP server',
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
			const result = await revokeMCPAuth({
				name: c.req.param('name'),
				oAuthStore: copilotMCPOAuthStore,
			});
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);
}
