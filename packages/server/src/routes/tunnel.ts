import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	getActiveTunnelUrl,
	getTunnelScopeOptionsFromContext,
	getTunnelQRCode,
	getTunnelStatus,
	handleTunnelStream,
	registerExternalTunnel,
	setExternalTunnel,
	startTunnel,
	stopActiveTunnel,
	stopTunnel,
} from './tunnel/service.ts';

export { getActiveTunnelUrl, setExternalTunnel, stopActiveTunnel };

const tunnelStatusSchema = z.object({
	scope: z.enum(['remote-control', 'project-share']),
	projectId: z.string().nullable(),
	status: z.enum(['idle', 'starting', 'connected', 'error']),
	url: z.string().nullable(),
	error: z.string().nullable(),
	binaryInstalled: z.boolean(),
	isRunning: z.boolean(),
});

const startTunnelBodySchema = z.object({
	port: z.number().int().optional(),
	scope: z.enum(['remote-control', 'project-share']).optional(),
	projectId: z.string().optional(),
});

const tunnelScopeQuerySchema = z.object({
	scope: z
		.enum(['remote-control', 'project-share'])
		.optional()
		.openapi({
			param: { name: 'scope', in: 'query' },
			description:
				'Tunnel scope to inspect or stream. Defaults to remote-control.',
		}),
	projectId: z
		.string()
		.optional()
		.openapi({
			param: { name: 'projectId', in: 'query' },
			description: 'Required when scope is project-share.',
		}),
});

const tunnelActionResponseSchema = z.object({
	ok: z.boolean(),
	scope: z.enum(['remote-control', 'project-share']).optional(),
	projectId: z.string().nullable().optional(),
	url: z.string().nullable().optional(),
	message: z.string().optional(),
	error: z.string().optional(),
});

const registerTunnelBodySchema = z.object({
	url: z.string(),
	scope: z.enum(['remote-control', 'project-share']).optional(),
	projectId: z.string().optional(),
});

const tunnelErrorResponseSchema = z.object({
	ok: z.literal(false).optional(),
	error: z.string(),
});

const tunnelQrResponseSchema = z.object({
	ok: z.boolean(),
	scope: z.enum(['remote-control', 'project-share']).optional(),
	projectId: z.string().nullable().optional(),
	url: z.string().optional(),
	qrCode: z.string().optional(),
	error: z.string().optional(),
});

const tunnelStreamSchema = z.string().openapi({
	description: 'SSE stream of tunnel status updates',
});

const tunnelStreamRoute = {
	tags: ['tunnel'],
	summary: 'Subscribe to tunnel status stream',
	responses: {
		'200': {
			description: 'SSE stream of tunnel status updates',
			content: {
				'text/event-stream': {
					schema: tunnelStreamSchema,
				},
			},
		},
	},
};

export function registerTunnelRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/tunnel/status',
			tags: ['tunnel'],
			operationId: 'getTunnelStatus',
			summary: 'Get tunnel status',
			request: { query: tunnelScopeQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: tunnelStatusSchema },
					},
				},
			},
		},
		async (c) =>
			c.json(await getTunnelStatus(getTunnelScopeOptionsFromContext(c))),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/tunnel/start',
			tags: ['tunnel'],
			operationId: 'startTunnel',
			summary: 'Start a tunnel',
			request: {
				body: {
					required: false,
					content: {
						'application/json': { schema: startTunnelBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: tunnelActionResponseSchema },
					},
				},
				'500': {
					description: 'Tunnel failed to start',
					content: {
						'application/json': { schema: tunnelActionResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const body: z.infer<typeof startTunnelBodySchema> = await c.req
				.json<z.infer<typeof startTunnelBodySchema>>()
				.catch(() => ({}));
			const result = await startTunnel(body.port, {
				scope: body.scope,
				projectId: body.projectId,
			});
			return c.json(result, result.ok ? 200 : 500);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/tunnel/register',
			tags: ['tunnel'],
			operationId: 'registerTunnel',
			summary: 'Register an external tunnel URL',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: registerTunnelBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: tunnelActionResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: tunnelErrorResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const body: Partial<z.infer<typeof registerTunnelBodySchema>> =
				await c.req
					.json<z.infer<typeof registerTunnelBodySchema>>()
					.catch(() => ({ url: undefined }));
			const result = registerExternalTunnel(body.url, {
				scope: body.scope,
				projectId: body.projectId,
			});
			return c.json(result, result.ok ? 200 : 400);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/tunnel/stop',
			tags: ['tunnel'],
			operationId: 'stopTunnel',
			summary: 'Stop the tunnel',
			request: { query: tunnelScopeQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: tunnelActionResponseSchema },
					},
				},
				'500': {
					description: 'Tunnel failed to stop',
					content: {
						'application/json': { schema: tunnelActionResponseSchema },
					},
				},
			},
		},
		(c) => {
			const result = stopTunnel(getTunnelScopeOptionsFromContext(c));
			return c.json(result, result.ok ? 200 : 500);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/tunnel/qr',
			tags: ['tunnel'],
			operationId: 'getTunnelQR',
			summary: 'Get QR code for tunnel URL',
			request: { query: tunnelScopeQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: tunnelQrResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: tunnelErrorResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const result = await getTunnelQRCode(getTunnelScopeOptionsFromContext(c));
			return c.json(result, result.ok ? 200 : 400);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/tunnel/stream',
			operationId: 'subscribeTunnelStream',
			request: { query: tunnelScopeQuerySchema },
			...tunnelStreamRoute,
		},
		handleTunnelStream,
	);
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/tunnel/stream',
			operationId: 'subscribeTunnelStreamPost',
			request: { query: tunnelScopeQuerySchema },
			...tunnelStreamRoute,
		},
		handleTunnelStream,
	);
}
