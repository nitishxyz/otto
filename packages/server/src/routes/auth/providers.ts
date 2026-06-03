import { z } from '@hono/zod-openapi';
import {
	catalog,
	isBuiltInProviderId,
	logger,
	removeAuth,
	setAuth,
	type ProviderId,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';

const providerParamSchema = z.object({
	provider: z.string().openapi({
		param: { name: 'provider', in: 'path' },
	}),
});

const addProviderApiKeyBodySchema = z.object({
	apiKey: z.string(),
});

const providerAuthResponseSchema = z.object({
	success: z.boolean(),
	provider: z.string(),
});

const providerAuthErrorSchema = z.object({
	error: z.string(),
});

export function registerAuthProviderRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/{provider}',
			tags: ['auth'],
			operationId: 'addProviderApiKey',
			summary: 'Add API key for a provider',
			request: {
				params: providerParamSchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: addProviderApiKeyBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: providerAuthResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: providerAuthErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const provider = c.req.param('provider') as ProviderId;
				const { apiKey } = addProviderApiKeyBodySchema.parse(
					await c.req.json(),
				);

				if (!isBuiltInProviderId(provider) || !catalog[provider]) {
					return c.json({ error: 'Unknown provider' }, 400);
				}

				if (!apiKey) {
					return c.json({ error: 'API key required' }, 400);
				}

				await setAuth(
					provider,
					{ type: 'api', key: apiKey },
					undefined,
					'global',
				);

				return c.json({ success: true, provider });
			} catch (error) {
				logger.error('Failed to add provider', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/auth/{provider}',
			tags: ['auth'],
			operationId: 'removeProvider',
			summary: 'Remove auth for a provider',
			request: {
				params: providerParamSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: providerAuthResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: providerAuthErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const provider = c.req.param('provider') as ProviderId;

				if (!isBuiltInProviderId(provider) || !catalog[provider]) {
					return c.json({ error: 'Unknown provider' }, 400);
				}

				await removeAuth(provider, undefined, 'global');

				return c.json({ success: true, provider });
			} catch (error) {
				logger.error('Failed to remove provider', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
