import {
	authorizeXaiDevice,
	exchangeOpenAIDeviceCode,
	logger,
	pollOttoRouterDeviceCodeOnce,
	pollOpenAIDeviceCodeOnce,
	requestOttoRouterDeviceCode,
	requestOpenAIDeviceCode,
	setAuth,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import {
	openAIDeviceSessions,
	ottorouterDeviceSessions,
	xaiDeviceSessions,
} from '../state.ts';
import {
	devicePollBodySchema,
	devicePollResponseSchema,
	deviceStartResponseSchema,
	errorResponseSchema,
} from './schemas.ts';

export function registerOpenAIDeviceRoutes(app: Hono) {
	registerOpenAIDeviceStartRoute(app);
	registerOpenAIDevicePollRoute(app);
}

export function registerXaiDeviceRoutes(app: Hono) {
	registerXaiDeviceStartRoute(app);
	registerXaiDevicePollRoute(app);
}

export function registerOttoRouterDeviceRoutes(app: Hono) {
	registerOttoRouterDeviceStartRoute(app);
	registerOttoRouterDevicePollRoute(app);
}

function registerOpenAIDeviceStartRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/openai/device/start',
			tags: ['auth'],
			operationId: 'startOpenAIDeviceFlow',
			summary: 'Start OpenAI device flow authentication',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: deviceStartResponseSchema },
					},
				},
				'500': {
					description: 'Server Error',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const deviceData = await requestOpenAIDeviceCode();
				const sessionId = crypto.randomUUID();
				openAIDeviceSessions.set(sessionId, {
					deviceAuthId: deviceData.deviceAuthId,
					userCode: deviceData.userCode,
					interval: deviceData.interval,
					createdAt: Date.now(),
				});
				return c.json({
					sessionId,
					userCode: deviceData.userCode,
					verificationUri: deviceData.verificationUri,
					interval: deviceData.interval,
				});
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'Failed to start OpenAI device flow';
				logger.error('OpenAI device flow start failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}

function registerOpenAIDevicePollRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/openai/device/poll',
			tags: ['auth'],
			operationId: 'pollOpenAIDeviceFlow',
			summary: 'Poll OpenAI device flow for completion',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: devicePollBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: devicePollResponseSchema } },
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { sessionId } = await c.req.json<{ sessionId: string }>();
				if (!sessionId || !openAIDeviceSessions.has(sessionId)) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const session = openAIDeviceSessions.get(sessionId);
				if (!session) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const result = await pollOpenAIDeviceCodeOnce(
					session.deviceAuthId,
					session.userCode,
				);
				if (result.status === 'pending') {
					return c.json({ status: 'pending' });
				}
				if (result.status === 'error') {
					openAIDeviceSessions.delete(sessionId);
					return c.json({ status: 'error', error: result.error });
				}

				const tokens = await exchangeOpenAIDeviceCode(
					result.code,
					result.codeVerifier,
				);
				await setAuth(
					'openai',
					{
						type: 'oauth',
						refresh: tokens.refresh,
						access: tokens.access,
						expires: tokens.expires,
						accountId: tokens.accountId,
						idToken: tokens.idToken,
					},
					undefined,
					'global',
				);
				openAIDeviceSessions.delete(sessionId);
				return c.json({ status: 'complete' });
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Poll failed';
				logger.error('OpenAI device poll failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}

function registerXaiDeviceStartRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/xai/device/start',
			tags: ['auth'],
			operationId: 'startXaiDeviceFlow',
			summary: 'Start xAI device flow authentication',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: deviceStartResponseSchema },
					},
				},
				'500': {
					description: 'Server Error',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const authorization = await authorizeXaiDevice();
				const sessionId = crypto.randomUUID();
				xaiDeviceSessions.set(sessionId, {
					status: 'pending',
					createdAt: Date.now(),
				});
				void authorization
					.waitForTokens()
					.then(async (tokens) => {
						await setAuth(
							'xai',
							{
								type: 'oauth',
								refresh: tokens.refresh,
								access: tokens.access,
								expires: tokens.expires,
								idToken: tokens.idToken,
								scopes: tokens.scopes,
							},
							undefined,
							'global',
						);
						const session = xaiDeviceSessions.get(sessionId);
						if (session) session.status = 'complete';
					})
					.catch((error: unknown) => {
						const message =
							error instanceof Error ? error.message : 'Authorization failed';
						const session = xaiDeviceSessions.get(sessionId);
						if (session) {
							session.status = 'error';
							session.error = message;
						}
						logger.error('xAI device authorization failed', error);
					});

				return c.json({
					sessionId,
					userCode: authorization.userCode,
					verificationUri:
						authorization.verificationUriComplete ??
						authorization.verificationUri,
					interval: 5,
				});
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'Failed to start xAI device flow';
				logger.error('xAI device flow start failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}

function registerXaiDevicePollRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/xai/device/poll',
			tags: ['auth'],
			operationId: 'pollXaiDeviceFlow',
			summary: 'Poll xAI device flow for completion',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: devicePollBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: devicePollResponseSchema } },
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			const { sessionId } = await c.req.json<{ sessionId: string }>();
			const session = sessionId ? xaiDeviceSessions.get(sessionId) : undefined;
			if (!session) {
				return c.json({ error: 'Session expired or invalid' }, 400);
			}
			if (session.status === 'pending') {
				return c.json({ status: 'pending' });
			}
			xaiDeviceSessions.delete(sessionId);
			if (session.status === 'error') {
				return c.json({
					status: 'error',
					error: session.error ?? 'Authorization failed',
				});
			}
			return c.json({ status: 'complete' });
		},
	);
}

function registerOttoRouterDeviceStartRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/ottorouter/device/start',
			tags: ['auth'],
			operationId: 'startOttoRouterDeviceFlow',
			summary: 'Start OttoRouter OAuth device flow authentication',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: deviceStartResponseSchema },
					},
				},
				'500': {
					description: 'Server Error',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const deviceData = await requestOttoRouterDeviceCode();
				const sessionId = crypto.randomUUID();
				ottorouterDeviceSessions.set(sessionId, {
					deviceCode: deviceData.deviceCode,
					interval: deviceData.interval,
					createdAt: Date.now(),
				});
				return c.json({
					sessionId,
					userCode: deviceData.userCode,
					verificationUri:
						deviceData.verificationUriComplete ?? deviceData.verificationUri,
					interval: deviceData.interval,
				});
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'Failed to start OttoRouter device flow';
				logger.error('OttoRouter device flow start failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}

function registerOttoRouterDevicePollRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/ottorouter/device/poll',
			tags: ['auth'],
			operationId: 'pollOttoRouterDeviceFlow',
			summary: 'Poll OttoRouter OAuth device flow for completion',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: devicePollBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: devicePollResponseSchema } },
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { sessionId } = await c.req.json<{ sessionId: string }>();
				const session = sessionId
					? ottorouterDeviceSessions.get(sessionId)
					: undefined;
				if (!session) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const result = await pollOttoRouterDeviceCodeOnce(session.deviceCode);
				if (result.status === 'pending') {
					return c.json({ status: 'pending' });
				}
				if (result.status === 'error') {
					ottorouterDeviceSessions.delete(sessionId);
					return c.json({ status: 'error', error: result.error });
				}

				await setAuth(
					'ottorouter',
					{
						type: 'oauth',
						refresh: result.tokens.refresh,
						access: result.tokens.access,
						expires: result.tokens.expires,
						idToken: result.tokens.idToken,
						scopes: result.tokens.scopes,
					},
					undefined,
					'global',
				);
				ottorouterDeviceSessions.delete(sessionId);
				return c.json({ status: 'complete' });
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Poll failed';
				logger.error('OttoRouter device poll failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}
