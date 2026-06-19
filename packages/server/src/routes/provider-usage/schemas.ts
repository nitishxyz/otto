import { z } from '@hono/zod-openapi';

export const providerUsageParamsSchema = z.object({
	provider: z.enum(['anthropic', 'openai', 'xai', 'kimi']).openapi({
		param: { name: 'provider', in: 'path' },
	}),
});

const providerUsageWindowSchema = z.object({
	usedPercent: z.number().optional(),
	windowSeconds: z.number().int().optional(),
	resetsAt: z.string().nullable().optional(),
	resetAfterSeconds: z.number().int().optional(),
});

export const providerUsageResponseSchema = z.object({
	provider: z.string(),
	primaryWindow: providerUsageWindowSchema.nullable().optional(),
	secondaryWindow: providerUsageWindowSchema.nullable().optional(),
	limitReached: z.boolean(),
	planType: z.string().nullable().optional(),
});

export const providerUsageErrorSchema = z.object({
	error: z.union([z.string(), z.object({ message: z.string() })]),
});
