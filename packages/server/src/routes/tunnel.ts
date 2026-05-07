import type { Hono } from 'hono';
import { openApiRoute } from '../openapi/route.ts';
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

export function registerTunnelRoutes(app: Hono) {
	openApiRoute(
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
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									status: {
										type: 'string',
										enum: ['idle', 'starting', 'connected', 'error'],
									},
									url: {
										type: 'string',
										nullable: true,
									},
									error: {
										type: 'string',
										nullable: true,
									},
									binaryInstalled: {
										type: 'boolean',
									},
									isRunning: {
										type: 'boolean',
									},
								},
								required: ['status', 'binaryInstalled', 'isRunning'],
							},
						},
					},
				},
			},
		},
		async (c) => c.json(await getTunnelStatus()),
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/tunnel/start',
			tags: ['tunnel'],
			operationId: 'startTunnel',
			summary: 'Start a tunnel',
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								port: {
									type: 'integer',
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
									url: {
										type: 'string',
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
			},
		},
		async (c) => {
			const body: { port?: number } = await c.req
				.json<{ port?: number }>()
				.catch(() => ({}));
			const result = await startTunnel(body.port);
			return c.json(result, result.ok ? 200 : 500);
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/tunnel/register',
			tags: ['tunnel'],
			operationId: 'registerTunnel',
			summary: 'Register an external tunnel URL',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								url: {
									type: 'string',
								},
							},
							required: ['url'],
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
									url: {
										type: 'string',
									},
									message: {
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
			const body: { url?: string } = await c.req
				.json<{ url?: string }>()
				.catch(() => ({}));
			const result = registerExternalTunnel(body.url);
			return c.json(result, result.ok ? 200 : 400);
		},
	);

	openApiRoute(
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
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									ok: {
										type: 'boolean',
									},
									message: {
										type: 'string',
									},
								},
								required: ['ok'],
							},
						},
					},
				},
			},
		},
		(c) => {
			const result = stopTunnel();
			return c.json(result, result.ok ? 200 : 500);
		},
	);

	openApiRoute(
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
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									ok: {
										type: 'boolean',
									},
									url: {
										type: 'string',
									},
									qrCode: {
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
			const result = await getTunnelQRCode();
			return c.json(result, result.ok ? 200 : 400);
		},
	);

	const tunnelStreamRoute = {
		tags: ['tunnel'],
		summary: 'Subscribe to tunnel status stream',
		responses: {
			'200': {
				description: 'SSE stream of tunnel status updates',
				content: {
					'text/event-stream': {
						schema: { type: 'string' },
					},
				},
			},
		},
	};

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/tunnel/stream',
			operationId: 'subscribeTunnelStream',
			...tunnelStreamRoute,
		},
		handleTunnelStream,
	);
	openApiRoute(
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
