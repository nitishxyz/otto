import type { Hono } from 'hono';
import { logger, setOnboardingComplete } from '@ottocode/sdk';
import { openApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';

export function registerAuthOnboardingRoutes(app: Hono) {
	openApiRoute(
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
							schema: {
								type: 'object',
								properties: {
									success: {
										type: 'boolean',
									},
								},
								required: ['success'],
							},
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
