import { z } from '@hono/zod-openapi';

export const sessionIdParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
});

export const queueMessageParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
	messageId: z.string().openapi({
		param: { name: 'messageId', in: 'path' },
	}),
});

export const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

export const abortBodySchema = z.object({
	messageId: z.string().optional(),
	clearQueue: z.boolean().optional(),
});

export const abortResponseSchema = z.object({
	success: z.boolean(),
	wasRunning: z.boolean().optional(),
	messageId: z.string().optional(),
});

export const queueStateSchema = z.object({
	currentMessageId: z.string().nullable(),
	queuedMessages: z.array(
		z.object({
			assistantMessageId: z.string(),
			agent: z.string(),
			provider: z.string(),
			model: z.string(),
		}),
	),
	isRunning: z.boolean(),
});

export const sendNowResponseSchema = z.object({
	success: z.boolean(),
	promoted: z.boolean(),
	wasQueued: z.boolean().optional(),
	wasRunning: z.boolean().optional(),
	preemptedMessageId: z.string().nullable().optional(),
});

export const removeQueueResponseSchema = z.object({
	success: z.boolean(),
	removed: z.boolean().optional(),
	wasQueued: z.boolean().optional(),
	wasRunning: z.boolean().optional(),
	wasStored: z.boolean().optional(),
});

export const queueErrorSchema = z.object({
	error: z.string(),
});
