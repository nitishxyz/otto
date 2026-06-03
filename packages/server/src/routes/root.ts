import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { getServerInfo } from '../state.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';

const rootResponseSchema = z.string();

const serverInfoSchema = z.object({
	port: z.number().nullable(),
});

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
		(c) => {
			return c.json({
				...getServerInfo(),
			});
		},
	);
}
