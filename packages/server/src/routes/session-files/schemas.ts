import { z } from '@hono/zod-openapi';

export const sessionFilesParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
});

export const sessionFilesQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const fileOperationSchema = z.object({
	path: z.string(),
	operation: z.enum(['write', 'patch', 'create']),
	timestamp: z.number().int(),
	toolCallId: z.string(),
	toolName: z.string(),
	patch: z.string().optional(),
	content: z.string().optional(),
	artifact: z
		.object({
			kind: z.string(),
			patch: z.string().optional(),
			summary: z
				.object({
					additions: z.number().int(),
					deletions: z.number().int(),
				})
				.optional(),
		})
		.optional(),
});

const sessionFileSchema = z.object({
	path: z.string(),
	operations: z.array(fileOperationSchema),
	operationCount: z.number().int(),
	firstModified: z.number().int(),
	lastModified: z.number().int(),
});

export const sessionFilesResponseSchema = z.object({
	files: z.array(sessionFileSchema),
	totalFiles: z.number().int(),
	totalOperations: z.number().int(),
});

export const sessionFilesErrorSchema = z.object({
	error: z.string(),
});
