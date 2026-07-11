import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	createOwnerChallenge,
	exchangeOwnerAssertion,
	OWNER_SESSION_COOKIE,
	OwnerAuthorizationError,
} from './tunnel/owner-auth.ts';
import {
	createTunnelShare,
	listTunnelShares,
	revokeTunnelShare,
} from './tunnel/shares.ts';
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
	mode: z.enum(['managed', 'quick']),
	scope: z.enum(['remote-control', 'project-share']),
	projectId: z.string().nullable(),
	status: z.enum(['idle', 'starting', 'connected', 'error']),
	url: z.string().nullable(),
	error: z.string().nullable(),
	binaryInstalled: z.boolean(),
	isRunning: z.boolean(),
	hostname: z.string().nullable(),
	ottorouterConnected: z.boolean(),
});

const startTunnelBodySchema = z.object({
	port: z.number().int().optional(),
	mode: z.enum(['managed', 'quick']).optional(),
	scope: z.enum(['remote-control', 'project-share']).optional(),
	projectId: z.string().optional(),
});

const tunnelScopeQuerySchema = z.object({
	mode: z
		.enum(['managed', 'quick'])
		.optional()
		.openapi({
			param: { name: 'mode', in: 'query' },
			description: 'Tunnel mode to inspect. Defaults to quick.',
		}),
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
	mode: z.enum(['managed', 'quick']).optional(),
	scope: z.enum(['remote-control', 'project-share']).optional(),
	projectId: z.string().nullable().optional(),
	url: z.string().nullable().optional(),
	message: z.string().optional(),
	code: z.string().optional(),
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

const tunnelPingResponseSchema = z.object({
	status: z.literal('ok'),
});

const tunnelQrResponseSchema = z.object({
	ok: z.boolean(),
	mode: z.enum(['managed', 'quick']).optional(),
	scope: z.enum(['remote-control', 'project-share']).optional(),
	projectId: z.string().nullable().optional(),
	url: z.string().optional(),
	qrCode: z.string().optional(),
	error: z.string().optional(),
});

const tunnelStreamSchema = z.string().openapi({
	description: 'SSE stream of tunnel status updates',
});

const createTunnelShareBodySchema = z.object({
	projectId: z.string().min(1),
});

const tunnelShareSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	token: z.string(),
	url: z.string(),
	createdAt: z.number(),
});

const tunnelSharesSchema = z.object({ shares: z.array(tunnelShareSchema) });

const tunnelShareIdSchema = z.object({
	id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
});

const ownerChallengeBodySchema = z.object({}).strict();
const ownerChallengeResponseSchema = z.object({
	challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	device_id: z.string().uuid(),
	expires_in: z.literal(120),
});
const ownerSessionBodySchema = z
	.object({ assertion: z.string().min(1) })
	.strict();
const ownerSessionResponseSchema = z.object({
	access_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	token_type: z.literal('Bearer'),
	expires_in: z.literal(900),
});
const ownerAuthorizationErrorSchema = z.object({
	error: z.string(),
	error_description: z.string(),
});

function requestSource(
	c: Parameters<Parameters<typeof zodOpenApiRoute>[2]>[0],
) {
	return (
		c.req.header('cf-connecting-ip') ??
		c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown'
	);
}

function ownerAuthorizationError(
	c: Parameters<Parameters<typeof zodOpenApiRoute>[2]>[0],
	error: unknown,
) {
	c.header('Cache-Control', 'no-store');
	c.header('Pragma', 'no-cache');
	if (error instanceof OwnerAuthorizationError) {
		if (error.retryAfter) c.header('Retry-After', String(error.retryAfter));
		return c.json(
			{ error: error.code, error_description: error.message },
			error.status,
		);
	}
	return c.json(
		{
			error: 'invalid_assertion',
			error_description: 'Owner assertion validation failed',
		},
		401,
	);
}

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
			path: '/v1/tunnel/ping',
			tags: ['tunnel'],
			operationId: 'pingTunnelDaemon',
			summary: 'Check whether the tunnel daemon is reachable',
			responses: {
				'200': {
					description: 'Daemon is reachable',
					content: {
						'application/json': { schema: tunnelPingResponseSchema },
					},
				},
			},
		},
		(c) => c.json({ status: 'ok' as const }),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/tunnel/owner/challenge',
			tags: ['tunnel'],
			operationId: 'createTunnelOwnerChallenge',
			summary: 'Create a one-time daemon owner challenge',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: ownerChallengeBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Owner challenge created',
					content: {
						'application/json': { schema: ownerChallengeResponseSchema },
					},
				},
				'429': {
					description: 'Rate limited',
					content: {
						'application/json': { schema: ownerAuthorizationErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				c.header('Cache-Control', 'no-store');
				c.header('Pragma', 'no-cache');
				return c.json(await createOwnerChallenge(requestSource(c)));
			} catch (error) {
				return ownerAuthorizationError(c, error);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/tunnel/owner/session',
			tags: ['tunnel'],
			operationId: 'createTunnelOwnerSession',
			summary: 'Exchange a signed owner assertion for a daemon session',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: ownerSessionBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Owner session created',
					content: {
						'application/json': { schema: ownerSessionResponseSchema },
					},
				},
				'401': {
					description: 'Invalid assertion',
					content: {
						'application/json': { schema: ownerAuthorizationErrorSchema },
					},
				},
				'404': {
					description: 'Unknown or expired challenge',
					content: {
						'application/json': { schema: ownerAuthorizationErrorSchema },
					},
				},
				'409': {
					description: 'Challenge or assertion replayed',
					content: {
						'application/json': { schema: ownerAuthorizationErrorSchema },
					},
				},
				'429': {
					description: 'Rate limited',
					content: {
						'application/json': { schema: ownerAuthorizationErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const body = await c.req.json<z.infer<typeof ownerSessionBodySchema>>();
				const session = await exchangeOwnerAssertion(
					body.assertion,
					requestSource(c),
				);
				c.header(
					'Set-Cookie',
					`${OWNER_SESSION_COOKIE}=${session.access_token}; Max-Age=900; Path=/; HttpOnly; Secure; SameSite=Strict`,
				);
				c.header('Cache-Control', 'no-store');
				c.header('Pragma', 'no-cache');
				return c.json(session);
			} catch (error) {
				return ownerAuthorizationError(c, error);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/tunnel/shares',
			tags: ['tunnel'],
			operationId: 'createTunnelShare',
			summary: 'Create a project share token',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: createTunnelShareBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Project share created',
					content: { 'application/json': { schema: tunnelShareSchema } },
				},
				'409': {
					description: 'No active public tunnel',
					content: {
						'application/json': { schema: tunnelErrorResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const tunnelUrl = getActiveTunnelUrl();
			if (!tunnelUrl) {
				return c.json({ error: 'No active tunnel URL available' }, 409);
			}
			const body =
				await c.req.json<z.infer<typeof createTunnelShareBodySchema>>();
			return c.json(createTunnelShare(body.projectId, tunnelUrl), 200);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/tunnel/shares',
			tags: ['tunnel'],
			operationId: 'listTunnelShares',
			summary: 'List active project shares',
			responses: {
				'200': {
					description: 'Active project shares',
					content: { 'application/json': { schema: tunnelSharesSchema } },
				},
			},
		},
		(c) => c.json({ shares: listTunnelShares() }),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/tunnel/shares/{id}',
			tags: ['tunnel'],
			operationId: 'revokeTunnelShare',
			summary: 'Revoke a project share',
			request: { params: tunnelShareIdSchema },
			responses: {
				'200': {
					description: 'Project share revoked',
					content: {
						'application/json': { schema: z.object({ ok: z.literal(true) }) },
					},
				},
				'404': {
					description: 'Project share not found',
					content: {
						'application/json': { schema: tunnelErrorResponseSchema },
					},
				},
			},
		},
		(c) => {
			if (!revokeTunnelShare(c.req.param('id'))) {
				return c.json({ error: 'Project share not found' }, 404);
			}
			return c.json({ ok: true as const }, 200);
		},
	);

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
				mode: body.mode,
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
		async (c) => {
			const result = await stopTunnel(getTunnelScopeOptionsFromContext(c));
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
