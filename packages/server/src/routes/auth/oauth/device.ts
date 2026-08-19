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
	APIError,
	apiErrorResponseSchema,
} from '../../../runtime/errors/api-error.ts';
import {
	openAIDeviceSessions,
	ottorouterDeviceSessions,
	xaiDeviceSessions,
} from '../state.ts';
import {
	devicePollBodySchema,
	devicePollResponseSchema,
	deviceStartResponseSchema,
} from './schemas.ts';
import {
	pollDeviceFlow,
	startDeviceFlow,
	type DeviceFlowAdapter,
} from './device-flow.ts';

type OpenAISession = NonNullable<ReturnType<typeof openAIDeviceSessions.get>>;
type OpenAIComplete = Extract<
	Awaited<ReturnType<typeof pollOpenAIDeviceCodeOnce>>,
	{ status: 'complete' }
>;
type OttoRouterSession = NonNullable<
	ReturnType<typeof ottorouterDeviceSessions.get>
>;
type OttoRouterComplete = Extract<
	Awaited<ReturnType<typeof pollOttoRouterDeviceCodeOnce>>,
	{ status: 'complete' }
>;

const openAIDeviceFlow: DeviceFlowAdapter<OpenAISession, OpenAIComplete> = {
	async start() {
		const data = await requestOpenAIDeviceCode();
		return {
			session: {
				deviceAuthId: data.deviceAuthId,
				userCode: data.userCode,
				interval: data.interval,
				createdAt: Date.now(),
			},
			userCode: data.userCode,
			verificationUri: data.verificationUri,
			interval: data.interval,
		};
	},
	async poll(session) {
		const result = await pollOpenAIDeviceCodeOnce(
			session.deviceAuthId,
			session.userCode,
		);
		return result.status === 'complete'
			? { status: 'complete', value: result }
			: result;
	},
	async complete(result) {
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
	},
};

const ottoRouterDeviceFlow: DeviceFlowAdapter<
	OttoRouterSession,
	OttoRouterComplete
> = {
	async start() {
		const data = await requestOttoRouterDeviceCode();
		return {
			session: {
				deviceCode: data.deviceCode,
				interval: data.interval,
				createdAt: Date.now(),
			},
			userCode: data.userCode,
			verificationUri: data.verificationUriComplete ?? data.verificationUri,
			interval: data.interval,
		};
	},
	async poll(session) {
		const result = await pollOttoRouterDeviceCodeOnce(session.deviceCode);
		return result.status === 'complete'
			? { status: 'complete', value: result }
			: result;
	},
	async complete(result) {
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
	},
};

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
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				return c.json(
					await startDeviceFlow(openAIDeviceSessions, openAIDeviceFlow),
				);
			} catch (error) {
				logger.error('OpenAI device flow start failed', error);
				throw error;
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
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
				'500': {
					description: 'Server Error',
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { sessionId } = c.req.valid('json');
				return c.json(
					await pollDeviceFlow(
						openAIDeviceSessions,
						openAIDeviceFlow,
						sessionId,
					),
				);
			} catch (error) {
				logger.error('OpenAI device poll failed', error);
				throw error;
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
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const authorization = await authorizeXaiDevice();
				const sessionId = crypto.randomUUID();
				xaiDeviceSessions.create(sessionId, {
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
				logger.error('xAI device flow start failed', error);
				throw error;
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
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			const { sessionId } = c.req.valid('json');
			const session = sessionId ? xaiDeviceSessions.get(sessionId) : undefined;
			if (!session) throw new APIError('Session expired or invalid', 400);
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
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				return c.json(
					await startDeviceFlow(ottorouterDeviceSessions, ottoRouterDeviceFlow),
				);
			} catch (error) {
				logger.error('OttoRouter device flow start failed', error);
				throw error;
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
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
				'500': {
					description: 'Server Error',
					content: { 'application/json': { schema: apiErrorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { sessionId } = c.req.valid('json');
				return c.json(
					await pollDeviceFlow(
						ottorouterDeviceSessions,
						ottoRouterDeviceFlow,
						sessionId,
					),
				);
			} catch (error) {
				logger.error('OttoRouter device poll failed', error);
				throw error;
			}
		},
	);
}
