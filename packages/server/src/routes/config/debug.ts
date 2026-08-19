import { z } from '@hono/zod-openapi';
import { logger, readDebugConfig, writeDebugConfig } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';

const debugConfigSchema = z.object({
	enabled: z.boolean(),
	scopes: z.array(z.string()),
	logPath: z.string(),
	sessionsDir: z.string(),
	debugDir: z.string(),
});

const updateDebugConfigBodySchema = z.object({
	enabled: z.boolean().optional(),
	scopes: z.array(z.string()).optional(),
});

const updateDebugConfigResponseSchema = z.object({
	success: z.boolean(),
	debug: debugConfigSchema,
});

export function registerDebugConfigRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/debug',
			tags: ['config'],
			operationId: 'getDebugConfig',
			summary: 'Get debug configuration',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: debugConfigSchema,
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const debug = await readDebugConfig();
				return c.json(debug);
			} catch (error) {
				logger.error('Failed to load debug config', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'patch',
			path: '/v1/config/debug',
			tags: ['config'],
			operationId: 'updateDebugConfig',
			summary: 'Update debug configuration',
			request: {
				body: {
					required: true,
					content: {
						'application/json': {
							schema: updateDebugConfigBodySchema,
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: updateDebugConfigResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const body = c.req.valid('json');

				await writeDebugConfig({
					enabled: body.enabled,
					scopes: Array.isArray(body.scopes)
						? body.scopes.map((scope) => scope.trim()).filter(Boolean)
						: body.scopes,
				});

				const debug = await readDebugConfig();
				return c.json({ success: true, debug });
			} catch (error) {
				logger.error('Failed to update debug config', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
