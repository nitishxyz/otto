import { z } from '@hono/zod-openapi';

export const sessionIdParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
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

export const shareStatusSchema = z.object({
	shared: z.boolean(),
	shareId: z.string().optional(),
	url: z.string().optional(),
	title: z.string().nullable().optional(),
	createdAt: z.number().int().optional(),
	lastSyncedAt: z.number().int().optional(),
	lastSyncedMessageId: z.string().optional(),
	syncedMessages: z.number().int().optional(),
	totalMessages: z.number().int().optional(),
	pendingMessages: z.number().int().optional(),
	isSynced: z.boolean().optional(),
});

export const shareCreateResponseSchema = z.object({
	shared: z.boolean(),
	shareId: z.string().optional(),
	url: z.string().optional(),
	message: z.string().optional(),
});

export const shareSyncResponseSchema = z.object({
	synced: z.boolean(),
	url: z.string().optional(),
	newMessages: z.number().int().optional(),
	message: z.string().optional(),
});

export const shareDeleteResponseSchema = z.object({
	deleted: z.boolean(),
	sessionId: z.string(),
});

export const shareListItemSchema = z.object({
	sessionId: z.string(),
	shareId: z.string(),
	url: z.string(),
	title: z.string().nullable().optional(),
	createdAt: z.number().int(),
	lastSyncedAt: z.number().int(),
});

export const listSharesResponseSchema = z.object({
	shares: z.array(shareListItemSchema),
});

export const shareErrorSchema = z.object({
	error: z.string(),
});
