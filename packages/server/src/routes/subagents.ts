import { z } from '@hono/zod-openapi';
import { getDb } from '@ottocode/database';
import { loadConfig, logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { serializeError } from '../runtime/errors/api-error.ts';
import { listSubagentsForSession } from '../runtime/subagents/service.ts';
import { resolveRequestProjectRoot } from './project-context.ts';

const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
	status: z
		.enum(['running', 'completed', 'failed', 'cancelled'])
		.optional()
		.openapi({
			param: { name: 'status', in: 'query' },
			description: 'Filter sub-agents by status.',
		}),
});

const sessionIdParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
});

const subagentSchema = z.object({
	id: z.string(),
	parentSessionId: z.string(),
	childSessionId: z.string(),
	agent: z.string(),
	task: z.string(),
	status: z.enum(['running', 'completed', 'failed', 'cancelled']),
	summary: z.string().nullable(),
	reported: z.boolean(),
	createdAt: z.number(),
	updatedAt: z.number(),
});

const listSubagentsResponseSchema = z.object({
	subagents: z.array(subagentSchema),
});

export function registerSubagentsRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/subagents',
			tags: ['subagents'],
			operationId: 'listSessionSubagents',
			summary: 'List sub-agents spawned from a session',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: listSubagentsResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				const status = c.req.query('status');
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);
				const sessionId = c.req.param('sessionId');
				const records = await listSubagentsForSession(db, sessionId);
				const filtered = status
					? records.filter((record) => record.status === status)
					: records;
				return c.json({
					subagents: filtered.map((record) => ({
						id: record.id,
						parentSessionId: record.parentSessionId,
						childSessionId: record.childSessionId,
						agent: record.agent,
						task: record.task,
						status: record.status,
						summary: record.summary,
						reported: record.reported,
						createdAt: record.createdAt,
						updatedAt: record.updatedAt,
					})),
				});
			} catch (error) {
				logger.error('Failed to list subagents', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
