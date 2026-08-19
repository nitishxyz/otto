import {
	authorizeCopilot,
	logger,
	pollForCopilotTokenOnce,
	setAuth,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { toErrorMessage } from '../../../runtime/errors/handling.ts';
import { copilotDeviceSessions } from '../state.ts';
import {
	copilotPollBodySchema,
	copilotPollResponseSchema,
	copilotStartResponseSchema,
	errorResponseSchema,
} from './schemas.ts';

export function registerCopilotDeviceRoutes(app: Hono) {
	registerStartCopilotDeviceFlowRoute(app);
	registerPollCopilotDeviceFlowRoute(app);
}

function registerStartCopilotDeviceFlowRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/copilot/device/start',
			tags: ['auth'],
			operationId: 'startCopilotDeviceFlow',
			summary: 'Start Copilot device flow authentication',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: copilotStartResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const deviceData = await authorizeCopilot();
				const sessionId = crypto.randomUUID();
				copilotDeviceSessions.create(sessionId, {
					deviceCode: deviceData.deviceCode,
					interval: deviceData.interval,
					provider: 'copilot',
					createdAt: Date.now(),
				});
				return c.json({
					sessionId,
					userCode: deviceData.userCode,
					verificationUri: deviceData.verificationUri,
					interval: deviceData.interval,
				});
			} catch (error) {
				const message = toErrorMessage(error);
				logger.error('Copilot device flow start failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}

function registerPollCopilotDeviceFlowRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/copilot/device/poll',
			tags: ['auth'],
			operationId: 'pollCopilotDeviceFlow',
			summary: 'Poll Copilot device flow for completion',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: copilotPollBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: copilotPollResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { sessionId } = c.req.valid('json');
				if (!sessionId || !copilotDeviceSessions.has(sessionId)) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const session = copilotDeviceSessions.get(sessionId);
				if (!session) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const result = await pollForCopilotTokenOnce(session.deviceCode);
				if (result.status === 'complete') {
					copilotDeviceSessions.delete(sessionId);
					await setAuth(
						'copilot',
						{
							type: 'oauth',
							refresh: result.accessToken,
							access: result.accessToken,
							expires: 0,
						},
						undefined,
						'global',
					);
					return c.json({ status: 'complete' });
				}
				if (result.status === 'pending') {
					return c.json({ status: 'pending' });
				}
				if (result.status === 'error') {
					copilotDeviceSessions.delete(sessionId);
					return c.json({ status: 'error', error: result.error });
				}
				return c.json({ status: 'pending' });
			} catch (error) {
				const message = toErrorMessage(error);
				logger.error('Copilot device poll failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}
