import { logger, setAuth } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { toErrorMessage } from '../../../runtime/errors/handling.ts';
import { fetchCopilotModels } from '../service.ts';
import {
	copilotSaveResponseSchema,
	copilotTokenBodySchema,
	errorResponseSchema,
} from './schemas.ts';

export function registerCopilotTokenRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/copilot/token',
			tags: ['auth'],
			operationId: 'saveCopilotToken',
			summary: 'Save Copilot token after validating model access',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: copilotTokenBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: copilotSaveResponseSchema },
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
				const { token } = await c.req.json<{ token: string }>();
				const sanitized = token?.trim();
				if (!sanitized) {
					return c.json({ error: 'Copilot token is required' }, 400);
				}

				const modelsResult = await fetchCopilotModels(sanitized);
				if (!modelsResult.ok) {
					return c.json(
						{
							error: `Invalid Copilot token: ${modelsResult.message}`,
						},
						400,
					);
				}

				await setAuth(
					'copilot',
					{
						type: 'oauth',
						refresh: sanitized,
						access: sanitized,
						expires: 0,
					},
					undefined,
					'global',
				);

				const models = Array.from(modelsResult.models).sort();
				return c.json({
					success: true,
					provider: 'copilot',
					source: 'token',
					modelCount: models.length,
					hasGpt52Codex: modelsResult.models.has('gpt-5.2-codex'),
					sampleModels: models.slice(0, 25),
				});
			} catch (error) {
				const message = toErrorMessage(error);
				logger.error('Failed to save Copilot token', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}
