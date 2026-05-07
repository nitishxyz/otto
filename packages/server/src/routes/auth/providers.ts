import type { Hono } from 'hono';
import {
	catalog,
	isBuiltInProviderId,
	removeAuth,
	setAuth,
	type ProviderId,
} from '@ottocode/sdk';
import { logger } from '@ottocode/sdk';
import { openApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';

export function registerAuthProviderRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/{provider}',
			tags: ['auth'],
			operationId: 'addProviderApiKey',
			summary: 'Add API key for a provider',
			parameters: [
				{
					in: 'path',
					name: 'provider',
					required: true,
					schema: {
						type: 'string',
					},
				},
			],
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								apiKey: {
									type: 'string',
								},
							},
							required: ['apiKey'],
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									success: {
										type: 'boolean',
									},
									provider: {
										type: 'string',
									},
								},
								required: ['success', 'provider'],
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const provider = c.req.param('provider') as ProviderId;
				const { apiKey } = await c.req.json<{ apiKey: string }>();

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

	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/auth/{provider}',
			tags: ['auth'],
			operationId: 'removeProvider',
			summary: 'Remove auth for a provider',
			parameters: [
				{
					in: 'path',
					name: 'provider',
					required: true,
					schema: {
						type: 'string',
					},
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									success: {
										type: 'boolean',
									},
									provider: {
										type: 'string',
									},
								},
								required: ['success', 'provider'],
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
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
