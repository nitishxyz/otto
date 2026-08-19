import { logger, type ProviderId } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import { fetchProviderUsage } from './cache.ts';
import { ensureValidOAuth } from './oauth.ts';
import {
	providerUsageErrorSchema,
	providerUsageParamsSchema,
	providerUsageResponseSchema,
} from './schemas.ts';

export function registerProviderUsageRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/provider-usage/{provider}',
			tags: ['config'],
			operationId: 'getProviderUsage',
			summary: 'Get usage information for an OAuth provider',
			request: {
				params: providerUsageParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: providerUsageResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: providerUsageErrorSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: providerUsageErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const { provider } = c.req.valid('param');

				if (!isUsageProvider(provider)) {
					return c.json(
						{ error: { message: 'Usage not supported for this provider' } },
						400,
					);
				}

				const projectRoot = await resolveRequestProjectRoot(c);
				const tokenResult = await ensureValidOAuth(provider, projectRoot);
				if (!tokenResult) {
					return c.json(
						{
							error: {
								message: `No OAuth credentials for ${provider}. Usage is only available for OAuth-authenticated providers.`,
							},
						},
						404,
					);
				}

				const usage = await fetchProviderUsage(provider, tokenResult);
				c.header('Cache-Control', 'private, max-age=60');

				return c.json(usage);
			} catch (error) {
				logger.error('Failed to fetch provider usage', error);
				const errorResponse = serializeError(error);
				const status = (errorResponse.error.status || 500) as 500;
				return c.json(errorResponse, status);
			}
		},
	);
}

function isUsageProvider(provider: ProviderId): boolean {
	return (
		provider === 'anthropic' ||
		provider === 'openai' ||
		provider === 'xai' ||
		provider === 'kimi'
	);
}
