import { z } from '@hono/zod-openapi';
import {
	logger,
	pollKimiDeviceCodeOnce,
	requestKimiDeviceCode,
	setAuth,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { kimiDeviceSessions } from './state.ts';

const errorResponseSchema = z.object({ error: z.string() });

const kimiStartResponseSchema = z.object({
	sessionId: z.string(),
	userCode: z.string(),
	verificationUri: z.string(),
	interval: z.number().int(),
});

const kimiPollBodySchema = z.object({ sessionId: z.string() });

const kimiPollResponseSchema = z.object({
	status: z.enum(['complete', 'pending', 'error']),
	error: z.string().optional(),
});

export function registerAuthKimiRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/kimi/device/start',
			tags: ['auth'],
			operationId: 'startKimiDeviceFlow',
			summary: 'Start Kimi Code OAuth device flow authentication',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: kimiStartResponseSchema },
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
				const deviceData = await requestKimiDeviceCode();
				const sessionId = crypto.randomUUID();
				kimiDeviceSessions.set(sessionId, {
					deviceCode: deviceData.deviceCode,
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
						: 'Failed to start Kimi device flow';
				logger.error('Kimi device flow start failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/kimi/device/poll',
			tags: ['auth'],
			operationId: 'pollKimiDeviceFlow',
			summary: 'Poll Kimi Code OAuth device flow for completion',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: kimiPollBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: kimiPollResponseSchema } },
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
				if (!sessionId || !kimiDeviceSessions.has(sessionId)) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const session = kimiDeviceSessions.get(sessionId);
				if (!session) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const result = await pollKimiDeviceCodeOnce(session.deviceCode);
				if (result.status === 'pending') {
					return c.json({ status: 'pending' });
				}
				if (result.status === 'error') {
					kimiDeviceSessions.delete(sessionId);
					return c.json({ status: 'error', error: result.error });
				}

				await setAuth(
					'moonshot',
					{
						type: 'oauth',
						access: result.tokens.access,
						refresh: result.tokens.refresh,
						expires: result.tokens.expires,
						scopes: result.tokens.scopes,
					},
					undefined,
					'global',
				);
				kimiDeviceSessions.delete(sessionId);
				return c.json({ status: 'complete' });
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Poll failed';
				logger.error('Kimi device poll failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}
