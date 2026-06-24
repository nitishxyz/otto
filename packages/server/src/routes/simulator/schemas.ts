import { z } from '@hono/zod-openapi';

export const simulatorStateSchema = z.object({
	status: z.enum(['idle', 'starting', 'connected', 'error']),
	setupStatus: z.enum(['unsupported', 'missing_runner', 'ready', 'preparing']),
	setupMessage: z.string().nullable(),
	runner: z.string().nullable(),
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

export const startSimulatorBodySchema = z.object({
	port: z.number().int().optional(),
	device: z.string().optional(),
});

export const startSimulatorResponseSchema = simulatorCommandBaseSchema.merge(
	simulatorStateSchema.partial(),
);

export const stopSimulatorBodySchema = z.object({
	device: z.string().optional(),
});

export const listSimulatorsResponseSchema = z
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

export const buttonBodySchema = z.object({
	name: z.string().optional(),
	device: z.string().optional(),
});

export const buttonResponseSchema = simulatorCommandBaseSchema.extend({
	button: z.string(),
});

export const gestureBodySchema = z.object({
	gesture: z.unknown(),
	device: z.string().optional(),
});

export const gestureResponseSchema = simulatorCommandBaseSchema.extend({
	gesture: z.unknown(),
});

export const rotateBodySchema = z.object({
	orientation: z.enum([
		'portrait',
		'portrait_upside_down',
		'landscape_left',
		'landscape_right',
	]),
	device: z.string().optional(),
});

export const rotateResponseSchema = simulatorCommandBaseSchema.extend({
	orientation: z.string(),
});

export const simulatorLogsResponseSchema = z.object({
	ok: z.boolean(),
	logs: z.string().optional(),
	url: z.string().optional(),
	error: z.string().optional(),
});
