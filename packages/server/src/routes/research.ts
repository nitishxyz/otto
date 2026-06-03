import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	createResearchSession,
	deleteResearchSession,
	exportResearchSession,
	injectResearchContext,
	listResearchSessions,
} from './research/service.ts';

const sessionSchema = z
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
		totalInputTokens: z.number().nullable(),
		totalOutputTokens: z.number().nullable(),
		totalCachedTokens: z.number().nullable().optional(),
		totalCacheCreationTokens: z.number().nullable().optional(),
		totalToolTimeMs: z.number().nullable(),
		currentContextTokens: z.number().nullable().optional(),
		toolCounts: z.record(z.string(), z.number()).optional(),
		parentSessionId: z.string().nullable().optional(),
		branchPointMessageId: z.string().nullable().optional(),
		sessionType: z.enum(['main', 'branch', 'handoff']).optional(),
	})
	.passthrough();

const parentParamsSchema = z.object({
	parentId: z.string().openapi({
		param: { name: 'parentId', in: 'path' },
	}),
});

const researchParamsSchema = z.object({
	researchId: z.string().openapi({
		param: { name: 'researchId', in: 'path' },
	}),
});

const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const researchSessionBodySchema = z.object({
	provider: z.string().optional(),
	model: z.string().optional(),
	title: z.string().optional(),
});

const exportResearchBodySchema = z.object({
	provider: z.string().optional(),
	model: z.string().optional(),
	agent: z.string().optional(),
});

const injectResearchBodySchema = z.object({
	researchSessionId: z.string(),
	label: z.string().optional(),
});

const researchErrorSchema = z.object({
	error: z.string(),
});

export function registerResearchRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{parentId}/research',
			tags: ['sessions'],
			operationId: 'listResearchSessions',
			summary: 'List research sessions for a parent',
			request: {
				params: parentParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: z.object({ sessions: z.array(sessionSchema) }),
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: researchErrorSchema },
					},
				},
			},
		},
		listResearchSessions,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{parentId}/research',
			tags: ['sessions'],
			operationId: 'createResearchSession',
			summary: 'Create a research session',
			request: {
				params: parentParamsSchema,
				query: projectQuerySchema,
				body: {
					required: false,
					content: {
						'application/json': { schema: researchSessionBodySchema },
					},
				},
			},
			responses: {
				'201': {
					description: 'Created',
					content: {
						'application/json': {
							schema: z.object({
								session: sessionSchema,
								parentSessionId: z.string(),
							}),
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: researchErrorSchema },
					},
				},
			},
		},
		createResearchSession,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/research/{researchId}',
			tags: ['sessions'],
			operationId: 'deleteResearchSession',
			summary: 'Delete a research session',
			request: {
				params: researchParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: z.object({ success: z.boolean() }) },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: researchErrorSchema },
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: researchErrorSchema },
					},
				},
			},
		},
		deleteResearchSession,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{parentId}/inject',
			tags: ['sessions'],
			operationId: 'injectResearchContext',
			summary: 'Inject research context into parent session',
			request: {
				params: parentParamsSchema,
				query: projectQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: injectResearchBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: z.object({
								content: z.string(),
								label: z.string(),
								sessionId: z.string(),
								parentSessionId: z.string(),
								tokenEstimate: z.number().int(),
							}),
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: researchErrorSchema },
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: researchErrorSchema },
					},
				},
			},
		},
		injectResearchContext,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/research/{researchId}/export',
			tags: ['sessions'],
			operationId: 'exportResearchSession',
			summary: 'Export research session to a new main session',
			request: {
				params: researchParamsSchema,
				query: projectQuerySchema,
				body: {
					required: false,
					content: {
						'application/json': { schema: exportResearchBodySchema },
					},
				},
			},
			responses: {
				'201': {
					description: 'Created',
					content: {
						'application/json': {
							schema: z.object({
								newSession: sessionSchema,
								injectedContext: z.string(),
							}),
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: researchErrorSchema },
					},
				},
			},
		},
		exportResearchSession,
	);
}
