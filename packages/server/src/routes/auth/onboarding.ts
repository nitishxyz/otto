import { z } from '@hono/zod-openapi';
import { logger, setOnboardingComplete } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';

const completeOnboardingResponseSchema = z.object({
	success: z.boolean(),
});

export function registerAuthOnboardingRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/onboarding/complete',
			tags: ['auth'],
			operationId: 'completeOnboarding',
			summary: 'Mark onboarding as complete',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: completeOnboardingResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			try {
				await setOnboardingComplete();
				return c.json({ success: true });
			} catch (error) {
				logger.error('Failed to complete onboarding', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
