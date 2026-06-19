import type { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	listSimulators,
	refreshSimulatorStatus,
	startSimulator,
	stopSimulator,
} from './service.ts';
import {
	listSimulatorsResponseSchema,
	simulatorStateSchema,
	startSimulatorBodySchema,
	startSimulatorResponseSchema,
	stopSimulatorBodySchema,
} from './schemas.ts';

export function registerSimulatorLifecycleRoutes(app: Hono) {
	registerSimulatorStatusRoute(app);
	registerListSimulatorsRoute(app);
	registerStartSimulatorRoute(app);
	registerStopSimulatorRoute(app);
}

function registerSimulatorStatusRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/simulator/status',
			tags: ['simulator'],
			operationId: 'getSimulatorStatus',
			summary: 'Get serve-sim status',
			responses: {
				'200': {
					description: 'Current simulator stream state',
					content: {
						'application/json': { schema: simulatorStateSchema },
					},
				},
			},
		},
		async (c) => c.json(await refreshSimulatorStatus()),
	);
}

function registerListSimulatorsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/simulator/list',
			tags: ['simulator'],
			operationId: 'listSimulators',
			summary: 'List running serve-sim streams',
			responses: {
				'200': {
					description: 'Running serve-sim streams',
					content: {
						'application/json': { schema: listSimulatorsResponseSchema },
					},
				},
			},
		},
		async (c) => c.json(await listSimulators()),
	);
}

function registerStartSimulatorRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/simulator/start',
			tags: ['simulator'],
			operationId: 'startSimulator',
			summary: 'Start serve-sim',
			request: {
				body: {
					required: false,
					content: {
						'application/json': { schema: startSimulatorBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'serve-sim started',
					content: {
						'application/json': { schema: startSimulatorResponseSchema },
					},
				},
				'500': {
					description: 'serve-sim failed to start',
					content: {
						'application/json': { schema: startSimulatorResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const body = await c.req
				.json<z.infer<typeof startSimulatorBodySchema>>()
				.catch(() => ({}));
			const result = await startSimulator(body);
			return c.json(result, result.ok ? 200 : 500);
		},
	);
}

function registerStopSimulatorRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/simulator/stop',
			tags: ['simulator'],
			operationId: 'stopSimulator',
			summary: 'Stop serve-sim',
			request: {
				body: {
					required: false,
					content: {
						'application/json': { schema: stopSimulatorBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'serve-sim stopped',
					content: {
						'application/json': { schema: startSimulatorResponseSchema },
					},
				},
				'500': {
					description: 'serve-sim failed to stop',
					content: {
						'application/json': { schema: startSimulatorResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const body: z.infer<typeof stopSimulatorBodySchema> = await c.req
				.json<z.infer<typeof stopSimulatorBodySchema>>()
				.catch(() => ({}));
			const result = await stopSimulator(body.device);
			return c.json(result, result.ok ? 200 : 500);
		},
	);
}
