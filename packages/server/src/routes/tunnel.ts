import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	getActiveTunnelUrl,
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
	status: z.enum(['idle', 'starting', 'connected', 'error']),
	url: z.string().nullable(),
	error: z.string().nullable(),
	binaryInstalled: z.boolean(),
	isRunning: z.boolean(),
});

const startTunnelBodySchema = z.object({
	port: z.number().int().optional(),
});

const tunnelActionResponseSchema = z.object({
	ok: z.boolean(),
	url: z.string().nullable().optional(),
	message: z.string().optional(),
	error: z.string().optional(),
});

const registerTunnelBodySchema = z.object({
	url: z.string(),
});

const tunnelErrorResponseSchema = z.object({
	ok: z.literal(false).optional(),
	error: z.string(),
});

const tunnelQrResponseSchema = z.object({
	ok: z.boolean(),
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
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: tunnelStatusSchema },
					},
				},
			},
		},
		async (c) => c.json(await getTunnelStatus()),
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
			const result = await startTunnel(body.port);
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
			const body: { url?: string } = await c.req
				.json<z.infer<typeof registerTunnelBodySchema>>()
				.catch(() => ({ url: undefined }));
			const result = registerExternalTunnel(body.url);
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
			const result = stopTunnel();
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
			const result = await getTunnelQRCode();
			return c.json(result, result.ok ? 200 : 400);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/tunnel/stream',
			operationId: 'subscribeTunnelStream',
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
			...tunnelStreamRoute,
		},
		handleTunnelStream,
	);
}
