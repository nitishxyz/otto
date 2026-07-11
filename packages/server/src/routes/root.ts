import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { getServerInfo } from '../state.ts';
import { isDaemonTokenAuthorized } from '../tunnel-auth.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';

const rootResponseSchema = z.string();

const serverInfoSchema = z.object({
	port: z.number().nullable(),
	version: z.string().nullable(),
	pid: z.number(),
	daemonId: z.string().nullable(),
	startedAt: z.number(),
});

async function isDaemonHealthAuthorized(
	c: Parameters<Parameters<typeof zodOpenApiRoute>[2]>[0],
) {
	if (!process.env.OTTO_DAEMON_ID) return true;
	return isDaemonTokenAuthorized(c);
}

export function registerRootRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/',
			tags: ['server'],
			operationId: 'getRoot',
			summary: 'Server health check',
			responses: {
				'200': {
					description: 'Server is running',
					content: {
						'text/plain': {
							schema: rootResponseSchema,
						},
					},
				},
			},
		},
		(c) => c.text('otto server running'),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/server/info',
			tags: ['server'],
			operationId: 'getServerInfo',
			summary: 'Get server runtime information',
			responses: {
				'200': {
					description: 'Server runtime metadata',
					content: {
						'application/json': {
							schema: serverInfoSchema,
						},
					},
				},
			},
		},
		async (c) => {
			if (!(await isDaemonHealthAuthorized(c))) {
				return c.json({ error: 'Unauthorized' }, 401);
			}
			return c.json({
				...getServerInfo(),
			});
		},
	);
}
