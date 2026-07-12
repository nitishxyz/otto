import { z } from '@hono/zod-openapi';

export const errorResponseSchema = z.object({ error: z.string() });
export const githubDisconnectSchema = z.object({ success: z.boolean() });

export const githubUserSchema = z.object({
	login: z.string(),
	name: z.string().nullable(),
	avatarUrl: z.string(),
});

export const githubRepoSchema = z.object({
	id: z.number(),
	name: z.string(),
	fullName: z.string(),
	cloneUrl: z.string(),
	private: z.boolean(),
	description: z.string().nullable(),
});

export const githubStatusSchema = z.object({
	connected: z.boolean(),
	user: githubUserSchema.optional(),
});

export const githubDeviceStartSchema = z.object({
	sessionId: z.string(),
	userCode: z.string(),
	verificationUri: z.string(),
	interval: z.number().int(),
	expiresIn: z.number().int(),
});

export const githubDevicePollBodySchema = z.object({ sessionId: z.string() });

export const githubDevicePollSchema = z.object({
	status: z.enum(['complete', 'pending', 'error']),
	user: githubUserSchema.optional(),
	error: z.string().optional(),
});

export const githubReposQuerySchema = z.object({
	page: z.coerce.number().int().positive().optional().default(1),
	search: z.string().optional(),
});

export const githubReposSchema = z.object({ repos: z.array(githubRepoSchema) });

export const githubCloneBodySchema = z.object({
	url: z.string().url(),
	path: z.string().min(1),
});

export const githubCloneSchema = z.object({ path: z.string() });
