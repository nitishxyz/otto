import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	completeMCPAuth,
	getMCPAuthStatus,
	initiateMCPAuth,
	revokeMCPAuth,
} from './service.ts';
import { copilotMCPOAuthStore, copilotMCPSessions } from './state.ts';

const mcpServerNameParamsSchema = z.object({
	name: z.string().openapi({
		param: { name: 'name', in: 'path' },
		description: 'MCP server name',
	}),
});

const mcpToolSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
});

const mcpAuthResponseSchema = z.object({
	ok: z.boolean(),
	name: z.string().optional(),
	authUrl: z.string().optional(),
	authType: z.string().optional(),
	authenticated: z.boolean().optional(),
	sessionId: z.string().optional(),
	userCode: z.string().optional(),
	verificationUri: z.string().optional(),
	interval: z.number().int().optional(),
	message: z.string().optional(),
	status: z.enum(['complete', 'pending', 'error']).optional(),
	connected: z.boolean().optional(),
	tools: z.array(mcpToolSchema).optional(),
	error: z.string().optional(),
});

const completeMCPAuthBodySchema = z.object({
	code: z.string().optional(),
	sessionId: z.string().optional(),
});

const mcpAuthStatusResponseSchema = z.object({
	authenticated: z.boolean(),
	authType: z.string().optional(),
});

const mcpAuthActionResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});

const mcpAuthErrorSchema = z.object({
	error: z.string(),
});

export function registerMCPAuthRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/mcp/servers/{name}/auth',
			tags: ['mcp'],
			operationId: 'initiateMCPAuth',
			summary: 'Initiate auth for an MCP server',
			request: {
				params: mcpServerNameParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: mcpAuthResponseSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: mcpAuthErrorSchema },
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

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/mcp/servers/{name}/auth/callback',
			tags: ['mcp'],
			operationId: 'completeMCPAuth',
			summary: 'Complete MCP server auth callback',
			request: {
				params: mcpServerNameParamsSchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: completeMCPAuthBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: mcpAuthResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: mcpAuthErrorSchema },
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

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/mcp/servers/{name}/auth/status',
			tags: ['mcp'],
			operationId: 'getMCPAuthStatus',
			summary: 'Get auth status for an MCP server',
			request: {
				params: mcpServerNameParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: mcpAuthStatusResponseSchema },
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

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/mcp/servers/{name}/auth',
			tags: ['mcp'],
			operationId: 'revokeMCPAuth',
			summary: 'Revoke auth for an MCP server',
			request: {
				params: mcpServerNameParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: mcpAuthActionResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: mcpAuthErrorSchema },
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
