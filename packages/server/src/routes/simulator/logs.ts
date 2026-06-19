import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { getSimulatorLogs } from './service.ts';
import { simulatorLogsResponseSchema } from './schemas.ts';

export function registerSimulatorLogsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/simulator/logs',
			tags: ['simulator'],
			operationId: 'getSimulatorLogs',
			summary: 'Get serve-sim logs',
			responses: {
				'200': {
					description: 'Simulator logs',
					content: {
						'application/json': { schema: simulatorLogsResponseSchema },
					},
				},
				'400': {
					description: 'No active simulator',
					content: {
						'application/json': { schema: simulatorLogsResponseSchema },
					},
				},
			},
		},
		getSimulatorLogs,
	);
}
