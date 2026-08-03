import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { isTunnelRequest } from '../../tunnel-auth.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import { configureMCPAuthCallback } from './local-oauth-callback.ts';
import { startMCPServer, stopMCPServer, testMCPServer } from './service.ts';
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

const mcpLifecycleResponseSchema = z.object({
	ok: z.boolean(),
	name: z.string().optional(),
	connected: z.boolean().optional(),
	tools: z.array(mcpToolSchema).optional(),
	authRequired: z.boolean().optional(),
	authType: z.string().optional(),
	sessionId: z.string().optional(),
	userCode: z.string().optional(),
	verificationUri: z.string().optional(),
	interval: z.number().int().optional(),
	authUrl: z.string().optional(),
	flowId: z.string().optional(),
	callbackUrl: z.string().optional(),
	expiresAt: z.number().optional(),
	callbackMode: z.enum(['daemon-loopback', 'client-relay']).optional(),
	error: z.string().optional(),
});

const mcpActionResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});

const mcpErrorSchema = z.object({
	error: z.string(),
});

export function registerMCPLifecycleRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/mcp/servers/{name}/start',
			tags: ['mcp'],
			operationId: 'startMCPServer',
			summary: 'Start an MCP server',
			request: {
				params: mcpServerNameParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: mcpLifecycleResponseSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: mcpErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const result = await startMCPServer({
				name: c.req.param('name'),
				projectRoot: await resolveRequestProjectRoot(c),
				oAuthStore: copilotMCPOAuthStore,
				sessions: copilotMCPSessions,
			});
			if (!result.ok) return c.json(result.body, result.status);
			return c.json(
				await configureMCPAuthCallback(result.body, isTunnelRequest(c)),
			);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/mcp/servers/{name}/stop',
			tags: ['mcp'],
			operationId: 'stopMCPServer',
			summary: 'Stop an MCP server',
			request: {
				params: mcpServerNameParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: mcpActionResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: mcpErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const result = await stopMCPServer(
				c.req.param('name'),
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
			method: 'post',
			path: '/v1/mcp/servers/{name}/test',
			tags: ['mcp'],
			operationId: 'testMCPServer',
			summary: 'Test connection to an MCP server',
			request: {
				params: mcpServerNameParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: mcpLifecycleResponseSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: mcpErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const result = await testMCPServer(
				c.req.param('name'),
				await resolveRequestProjectRoot(c),
			);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);
}
