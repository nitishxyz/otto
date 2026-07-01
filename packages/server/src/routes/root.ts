import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { getOttoHomeDir } from '@ottocode/sdk';
import { getServerInfo } from '../state.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';

const rootResponseSchema = z.string();

const serverInfoSchema = z.object({
	port: z.number().nullable(),
	version: z.string().nullable(),
	pid: z.number(),
	daemonId: z.string().nullable(),
	startedAt: z.number(),
});

function serverTokenPath(): string {
	return `${getOttoHomeDir().replace(/\/$/, '')}/server-token`;
}

async function isDaemonHealthAuthorized(
	c: Parameters<Parameters<typeof zodOpenApiRoute>[2]>[0],
) {
	if (!process.env.OTTO_DAEMON_ID) return true;
	const auth = c.req.header('authorization') || '';
	const headerToken = c.req.header('x-otto-server-token');
	const bearerToken = auth.toLowerCase().startsWith('bearer ')
		? auth.slice(7).trim()
		: undefined;
	const provided = headerToken || bearerToken;
	if (!provided) return false;
	try {
		const token = (await Bun.file(serverTokenPath()).text()).trim();
		return token.length > 0 && token === provided;
	} catch {
		return false;
	}
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
