import { z } from '@hono/zod-openapi';

export const errorResponseSchema = z.object({ error: z.string() });
export const htmlResponseSchema = z.string();

export const deviceStartResponseSchema = z.object({
	sessionId: z.string(),
	userCode: z.string(),
	verificationUri: z.string(),
	interval: z.number().int(),
});

export const devicePollBodySchema = z.object({ sessionId: z.string() });
export const devicePollResponseSchema = z.object({
	status: z.enum(['complete', 'pending', 'error']),
	error: z.string().optional(),
});

export const providerParamsSchema = z.object({
	provider: z.string().openapi({ param: { name: 'provider', in: 'path' } }),
});

export const oauthUrlBodySchema = z.object({
	mode: z.enum(['max', 'console']).optional().default('max'),
});

export const oauthUrlResponseSchema = z.object({
	url: z.string(),
	sessionId: z.string(),
	provider: z.string(),
});

export const oauthExchangeBodySchema = z.object({
	code: z.string(),
	sessionId: z.string(),
});

export const oauthSuccessResponseSchema = z.object({
	success: z.boolean(),
	provider: z.string(),
});

export const oauthStartQuerySchema = z.object({
	mode: z
		.enum(['max', 'console'])
		.optional()
		.default('max')
		.openapi({
			param: { name: 'mode', in: 'query' },
		}),
});

export const oauthCallbackQuerySchema = z.object({
	code: z
		.string()
		.optional()
		.openapi({ param: { name: 'code', in: 'query' } }),
	fragment: z
		.string()
		.optional()
		.openapi({
			param: { name: 'fragment', in: 'query' },
		}),
});
