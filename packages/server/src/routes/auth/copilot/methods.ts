import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { getGhImportCapability } from '../service.ts';
import { copilotMethodsSchema } from './schemas.ts';

export function registerCopilotMethodsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/auth/copilot/methods',
			tags: ['auth'],
			operationId: 'getCopilotAuthMethods',
			summary: 'Get available Copilot auth methods',
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: copilotMethodsSchema } },
				},
			},
		},
		async (c) => {
			const ghImport = getGhImportCapability();
			return c.json({
				oauth: true,
				token: true,
				ghImport,
			});
		},
	);
}
