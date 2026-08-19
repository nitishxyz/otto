import type { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	rotateSimulator,
	sendSimulatorButton,
	sendSimulatorGesture,
} from './service.ts';
import {
	buttonBodySchema,
	buttonResponseSchema,
	gestureBodySchema,
	gestureResponseSchema,
	rotateBodySchema,
	rotateResponseSchema,
} from './schemas.ts';

export function registerSimulatorActionRoutes(app: Hono) {
	registerSimulatorButtonRoute(app);
	registerSimulatorGestureRoute(app);
	registerSimulatorRotateRoute(app);
}

function registerSimulatorButtonRoute(app: Hono) {
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
}

function registerSimulatorGestureRoute(app: Hono) {
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
			const body = c.req.valid('json');
			const result = await sendSimulatorGesture(body.gesture, body.device);
			return c.json(result, result.ok ? 200 : 500);
		},
	);
}

function registerSimulatorRotateRoute(app: Hono) {
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
			const body = c.req.valid('json');
			const result = await rotateSimulator(body.orientation, body.device);
			return c.json(result, result.ok ? 200 : 500);
		},
	);
}
