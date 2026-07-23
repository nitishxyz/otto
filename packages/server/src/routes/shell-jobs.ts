import { z } from '@hono/zod-openapi';
import { loadConfig, logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { serializeError } from '../runtime/errors/api-error.ts';
import {
	abortActiveShellJob,
	detachActiveShellJob,
	listShellJobsForSession,
	type ShellJobSnapshot,
} from '../runtime/tools/active-shells.ts';
import { resolveRequestProjectRoot } from './project-context.ts';

const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description: 'Project root override.',
		}),
});

const sessionParamsSchema = z.object({
	sessionId: z.string().openapi({ param: { name: 'sessionId', in: 'path' } }),
});

const jobParamsSchema = sessionParamsSchema.extend({
	jobId: z.string().openapi({ param: { name: 'jobId', in: 'path' } }),
});

const shellJobSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	messageId: z.string(),
	callId: z.string().optional(),
	command: z.string(),
	cwd: z.string(),
	status: z.enum(['running', 'completed', 'failed', 'cancelled']),
	detached: z.boolean(),
	output: z.string(),
	exitCode: z.number().nullable(),
	result: z.unknown(),
	reported: z.boolean(),
	createdAt: z.number(),
	updatedAt: z.number(),
	completedAt: z.number().nullable(),
});

const listResponseSchema = z.object({ jobs: z.array(shellJobSchema) });
const jobResponseSchema = z.object({ job: shellJobSchema });
const errorResponseSchema = z.object({
	error: z.object({ message: z.string() }),
});

function serializeJob(job: ShellJobSnapshot) {
	const { projectRoot: _projectRoot, ...serialized } = job;
	return serialized;
}

export function registerShellJobsRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/shell-jobs',
			tags: ['shell-jobs'],
			operationId: 'listSessionShellJobs',
			summary: 'List active and recent shell jobs for a session',
			request: { params: sessionParamsSchema, query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: listResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const root = await resolveRequestProjectRoot(c);
				const cfg = await loadConfig(root);
				const jobs = listShellJobsForSession(
					c.req.param('sessionId'),
					cfg.projectRoot,
				);
				return c.json({ jobs: jobs.map(serializeJob) });
			} catch (error) {
				logger.error('Failed to list shell jobs', error);
				const response = serializeError(error);
				return c.json(response, response.error.status || 500);
			}
		},
	);

	for (const action of ['detach', 'abort'] as const) {
		zodOpenApiRoute(
			app,
			{
				method: 'post',
				path: `/v1/sessions/{sessionId}/shell-jobs/{jobId}/${action}`,
				tags: ['shell-jobs'],
				operationId:
					action === 'detach'
						? 'detachSessionShellJob'
						: 'abortSessionShellJob',
				summary:
					action === 'detach'
						? 'Detach a running inline shell job'
						: 'Stop a running shell job',
				request: { params: jobParamsSchema, query: projectQuerySchema },
				responses: {
					'200': {
						description: 'OK',
						content: { 'application/json': { schema: jobResponseSchema } },
					},
					'404': {
						description: 'Not found',
						content: { 'application/json': { schema: errorResponseSchema } },
					},
				},
			},
			async (c) => {
				try {
					const root = await resolveRequestProjectRoot(c);
					const cfg = await loadConfig(root);
					const sessionId = c.req.param('sessionId');
					const jobId = c.req.param('jobId');
					const job =
						action === 'detach'
							? detachActiveShellJob(jobId, sessionId, cfg.projectRoot)
							: abortActiveShellJob(jobId, sessionId, cfg.projectRoot);
					if (!job) {
						return c.json({ error: { message: 'Shell job not found' } }, 404);
					}
					return c.json({ job: serializeJob(job) });
				} catch (error) {
					logger.error(`Failed to ${action} shell job`, error);
					const response = serializeError(error);
					return c.json(response, response.error.status || 500);
				}
			},
		);
	}
}
