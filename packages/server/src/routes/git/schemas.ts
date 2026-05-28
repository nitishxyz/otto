import { z } from 'zod/v3';

export const gitStatusSchema = z.object({
	project: z.string().optional(),
});

export const gitDiffSchema = z.object({
	project: z.string().optional(),
	file: z.string(),
	staged: z
		.string()
		.optional()
		.transform((val) => val === 'true'),
});

export const gitStageSchema = z.object({
	project: z.string().optional(),
	files: z.array(z.string()),
});

export const gitUnstageSchema = z.object({
	project: z.string().optional(),
	files: z.array(z.string()),
});

export const gitRestoreSchema = z.object({
	project: z.string().optional(),
	files: z.array(z.string()),
});

export const gitDeleteSchema = z.object({
	project: z.string().optional(),
	files: z.array(z.string()),
});

export const gitCommitSchema = z.object({
	project: z.string().optional(),
	message: z.string().min(1),
});

export const gitGenerateCommitMessageSchema = z.object({
	project: z.string().optional(),
	sessionId: z.string().optional(),
});

export const gitPushSchema = z.object({
	project: z.string().optional(),
});

export const gitPullSchema = z.object({
	project: z.string().optional(),
});

export const gitRebaseSchema = z.object({
	project: z.string().optional(),
	action: z.enum(['continue', 'abort', 'skip']),
});

export const gitRemoteAddSchema = z.object({
	project: z.string().optional(),
	name: z.string().min(1),
	url: z.string().min(1),
});

export const gitRemoteRemoveSchema = z.object({
	project: z.string().optional(),
	name: z.string().min(1),
});

export const gitCheckoutBranchSchema = z.object({
	project: z.string().optional(),
	branch: z.string().min(1),
});

export const gitCreateBranchSchema = z.object({
	project: z.string().optional(),
	name: z.string().min(1),
	startPoint: z.string().optional(),
	checkout: z.boolean().optional().default(true),
});
