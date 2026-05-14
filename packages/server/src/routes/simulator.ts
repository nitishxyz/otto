import type { Hono } from 'hono';
import { openApiRoute } from '../openapi/route.ts';
import {
	getSimulatorLogs,
	getSimulatorStatus,
	listSimulators,
	rotateSimulator,
	sendSimulatorButton,
	sendSimulatorGesture,
	startSimulator,
	stopSimulator,
} from './simulator/service.ts';

const simulatorStateSchema = {
	type: 'object',
	properties: {
		status: {
			type: 'string',
			enum: ['idle', 'starting', 'connected', 'error'],
		},
		url: { type: 'string', nullable: true },
		deviceName: { type: 'string', nullable: true },
		udid: { type: 'string', nullable: true },
		port: { type: 'integer' },
		error: { type: 'string', nullable: true },
		updatedAt: { type: 'string' },
	},
	required: [
		'status',
		'url',
		'deviceName',
		'udid',
		'port',
		'error',
		'updatedAt',
	],
} as const;

export function registerSimulatorRoutes(app: Hono) {
	openApiRoute(
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
		(c) => c.json(getSimulatorStatus()),
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/simulator/list',
			tags: ['simulator'],
			operationId: 'listSimulators',
			summary: 'List running serve-sim streams',
			responses: {
				'200': { description: 'Running serve-sim streams' },
			},
		},
		async (c) => c.json(await listSimulators()),
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/simulator/start',
			tags: ['simulator'],
			operationId: 'startSimulator',
			summary: 'Start serve-sim',
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								port: { type: 'integer' },
								device: { type: 'string' },
							},
						},
					},
				},
			},
			responses: {
				'200': { description: 'serve-sim started' },
				'500': { description: 'serve-sim failed to start' },
			},
		},
		async (c) => {
			const body = await c.req
				.json<{ port?: number; device?: string }>()
				.catch(() => ({}));
			const result = await startSimulator(body);
			return c.json(result, result.ok ? 200 : 500);
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/simulator/stop',
			tags: ['simulator'],
			operationId: 'stopSimulator',
			summary: 'Stop serve-sim',
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: { device: { type: 'string' } },
						},
					},
				},
			},
			responses: {
				'200': { description: 'serve-sim stopped' },
				'500': { description: 'serve-sim failed to stop' },
			},
		},
		async (c) => {
			const body: { device?: string } = await c.req
				.json<{ device?: string }>()
				.catch(() => ({}));
			const result = await stopSimulator(body.device);
			return c.json(result, result.ok ? 200 : 500);
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/simulator/button',
			tags: ['simulator'],
			operationId: 'pressSimulatorButton',
			summary: 'Send a simulator button press',
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								name: { type: 'string' },
								device: { type: 'string' },
							},
						},
					},
				},
			},
			responses: {
				'200': { description: 'Button sent' },
				'500': { description: 'Button failed' },
			},
		},
		async (c) => {
			const body: { name?: string; device?: string } = await c.req
				.json<{ name?: string; device?: string }>()
				.catch(() => ({}));
			const result = await sendSimulatorButton(body.name, body.device);
			return c.json(result, result.ok ? 200 : 500);
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/simulator/gesture',
			tags: ['simulator'],
			operationId: 'sendSimulatorGesture',
			summary: 'Send a simulator touch gesture',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								gesture: {},
								device: { type: 'string' },
							},
							required: ['gesture'],
						},
					},
				},
			},
			responses: {
				'200': { description: 'Gesture sent' },
				'500': { description: 'Gesture failed' },
			},
		},
		async (c) => {
			const body = await c.req.json<{ gesture?: unknown; device?: string }>();
			const result = await sendSimulatorGesture(body.gesture, body.device);
			return c.json(result, result.ok ? 200 : 500);
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/simulator/rotate',
			tags: ['simulator'],
			operationId: 'rotateSimulator',
			summary: 'Rotate simulator orientation',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								orientation: {
									type: 'string',
									enum: [
										'portrait',
										'portrait_upside_down',
										'landscape_left',
										'landscape_right',
									],
								},
								device: { type: 'string' },
							},
							required: ['orientation'],
						},
					},
				},
			},
			responses: {
				'200': { description: 'Rotation sent' },
				'500': { description: 'Rotation failed' },
			},
		},
		async (c) => {
			const body = await c.req.json<{ orientation: string; device?: string }>();
			const result = await rotateSimulator(body.orientation, body.device);
			return c.json(result, result.ok ? 200 : 500);
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/simulator/logs',
			tags: ['simulator'],
			operationId: 'getSimulatorLogs',
			summary: 'Get serve-sim logs',
			responses: {
				'200': { description: 'Simulator logs' },
				'400': { description: 'No active simulator' },
			},
		},
		getSimulatorLogs,
	);
}
