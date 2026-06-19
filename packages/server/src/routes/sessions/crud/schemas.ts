import { z } from '@hono/zod-openapi';

export const sessionSchema = z
	.object({
		id: z.string(),
		title: z.string().nullable(),
		agent: z.string(),
		provider: z.string(),
		model: z.string(),
		projectPath: z.string(),
		createdAt: z.number(),
		lastActiveAt: z.number().nullable(),
		lastViewedAt: z.number().nullable().optional(),
		pinnedAt: z.number().nullable().optional(),
		totalInputTokens: z.number().nullable(),
		totalOutputTokens: z.number().nullable(),
		totalCachedTokens: z.number().nullable().optional(),
		totalCacheCreationTokens: z.number().nullable().optional(),
		totalReasoningTokens: z.number().nullable().optional(),
		totalToolTimeMs: z.number().nullable(),
		currentContextTokens: z.number().nullable().optional(),
		ownCostUsd: z.number().optional(),
		subagentCostUsd: z.number().optional(),
		totalCostUsd: z.number().optional(),
		contextSummary: z.string().nullable().optional(),
		lastCompactedAt: z.number().nullable().optional(),
		parentSessionId: z.string().nullable().optional(),
		branchPointMessageId: z.string().nullable().optional(),
		sessionType: z
			.enum(['main', 'branch', 'handoff', 'btw', 'otto', 'subagent'])
			.optional(),
		toolCounts: z.record(z.string(), z.number()).optional(),
		isRunning: z.boolean().optional(),
		fileStats: z
			.object({
				changedFiles: z.number(),
				additions: z.number(),
				deletions: z.number(),
				operations: z.number(),
			})
			.optional(),
	})
	.passthrough();

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

export const listSessionsQuerySchema = projectQuerySchema.extend({
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(200)
		.optional()
		.default(50)
		.openapi({
			param: { name: 'limit', in: 'query' },
			description: 'Maximum number of sessions to return',
		}),
	offset: z.coerce
		.number()
		.int()
		.min(0)
		.optional()
		.default(0)
		.openapi({
			param: { name: 'offset', in: 'query' },
			description: 'Offset for pagination',
		}),
	sessionType: z
		.enum(['otto'])
		.optional()
		.openapi({
			param: { name: 'sessionType', in: 'query' },
			description:
				'Filter to a specific session type. Currently only "otto" is supported; omit for the default listing (which excludes otto sessions).',
		}),
});

export const sessionParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
});

export const sessionProjectQuerySchema = projectQuerySchema;

export const createSessionBodySchema = z.object({
	title: z.string().nullable().optional(),
	agent: z.string().optional().openapi({
		description:
			'Agent name. Defaults to config. Agent provider/model overrides are used when provider/model are omitted.',
	}),
	provider: z.string().optional().openapi({
		description:
			'Provider override. If omitted, selected agent provider override, then config default are used.',
	}),
	model: z.string().optional().openapi({
		description:
			'Model override. If omitted, selected agent model override, then config default are used.',
	}),
	allowUnknownModel: z.boolean().optional().openapi({
		description:
			'Allow a model override that is not present in the configured model catalog.',
	}),
	parentSessionId: z.string().nullable().optional(),
	sessionType: z.enum(['main', 'btw', 'otto']).optional(),
});

export const updateSessionBodySchema = z.object({
	title: z.string().optional(),
	agent: z.string().optional(),
	provider: z.string().optional(),
	model: z.string().optional(),
	allowUnknownModel: z.boolean().optional(),
	isPinned: z.boolean().optional(),
});

export const errorResponseSchema = z.object({ error: z.string() });
export const successResponseSchema = z.object({ success: z.boolean() });
