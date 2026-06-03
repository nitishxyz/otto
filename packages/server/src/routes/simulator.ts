import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
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

const simulatorStateSchema = z.object({
	status: z.enum(['idle', 'starting', 'connected', 'error']),
	url: z.string().nullable(),
	deviceName: z.string().nullable(),
	udid: z.string().nullable(),
	port: z.number().int(),
	error: z.string().nullable(),
	updatedAt: z.string(),
});

const simulatorCommandBaseSchema = z.object({
	ok: z.boolean(),
	stdout: z.string().optional(),
	stderr: z.string().optional(),
	error: z.string().optional(),
});

const startSimulatorBodySchema = z.object({
	port: z.number().int().optional(),
	device: z.string().optional(),
});

const startSimulatorResponseSchema = simulatorCommandBaseSchema.merge(
	simulatorStateSchema.partial(),
);

const stopSimulatorBodySchema = z.object({
	device: z.string().optional(),
});

const listSimulatorsResponseSchema = z
	.object({
		ok: z.literal(true),
		state: simulatorStateSchema,
		raw: z.string(),
	})
	.or(
		z.object({
			ok: z.literal(false),
			error: z.string(),
			stdout: z.string(),
			stderr: z.string(),
		}),
	);

const buttonBodySchema = z.object({
	name: z.string().optional(),
	device: z.string().optional(),
});

const buttonResponseSchema = simulatorCommandBaseSchema.extend({
	button: z.string(),
});

const gestureBodySchema = z.object({
	gesture: z.unknown(),
	device: z.string().optional(),
});

const gestureResponseSchema = simulatorCommandBaseSchema.extend({
	gesture: z.unknown(),
});

const rotateBodySchema = z.object({
	orientation: z.enum([
		'portrait',
		'portrait_upside_down',
		'landscape_left',
		'landscape_right',
	]),
	device: z.string().optional(),
});

const rotateResponseSchema = simulatorCommandBaseSchema.extend({
	orientation: z.string(),
});

const simulatorLogsResponseSchema = z.object({
	ok: z.boolean(),
	logs: z.string().optional(),
	url: z.string().optional(),
	error: z.string().optional(),
});

export function registerSimulatorRoutes(app: Hono) {
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
		(c) => c.json(getSimulatorStatus()),
	);

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

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/simulator/button',
			tags: ['simulator'],
			operationId: 'pressSimulatorButton',
			summary: 'Send a simulator button press',
			request: {
				body: {
					required: false,
					content: {
						'application/json': { schema: buttonBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Button sent',
					content: {
						'application/json': { schema: buttonResponseSchema },
					},
				},
				'500': {
					description: 'Button failed',
					content: {
						'application/json': { schema: buttonResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const body: z.infer<typeof buttonBodySchema> = await c.req
				.json<z.infer<typeof buttonBodySchema>>()
				.catch(() => ({}));
			const result = await sendSimulatorButton(body.name, body.device);
			return c.json(result, result.ok ? 200 : 500);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/simulator/gesture',
			tags: ['simulator'],
			operationId: 'sendSimulatorGesture',
			summary: 'Send a simulator touch gesture',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: gestureBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Gesture sent',
					content: {
						'application/json': { schema: gestureResponseSchema },
					},
				},
				'500': {
					description: 'Gesture failed',
					content: {
						'application/json': { schema: gestureResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const body = await c.req.json<z.infer<typeof gestureBodySchema>>();
			const result = await sendSimulatorGesture(body.gesture, body.device);
			return c.json(result, result.ok ? 200 : 500);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/simulator/rotate',
			tags: ['simulator'],
			operationId: 'rotateSimulator',
			summary: 'Rotate simulator orientation',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: rotateBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Rotation sent',
					content: {
						'application/json': { schema: rotateResponseSchema },
					},
				},
				'500': {
					description: 'Rotation failed',
					content: {
						'application/json': { schema: rotateResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const body = await c.req.json<z.infer<typeof rotateBodySchema>>();
			const result = await rotateSimulator(body.orientation, body.device);
			return c.json(result, result.ok ? 200 : 500);
		},
	);

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
