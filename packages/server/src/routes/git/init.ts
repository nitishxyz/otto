import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import { gitStatusSchema } from './schemas.ts';
import { validateAndGetGitRoot } from './utils.ts';

const execFileAsync = promisify(execFile);

const gitProjectBodySchema = z.object({
	project: z.string().optional(),
});

const gitInitResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		initialized: z.boolean(),
		path: z.string(),
	}),
});

const gitErrorResponseSchema = z.object({
	status: z.literal('error'),
	error: z.string(),
	code: z.string().optional(),
});

export function registerInitRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/init',
			tags: ['git'],
			operationId: 'initGitRepo',
			summary: 'Initialize a git repository',
			request: {
				body: {
					required: false,
					content: {
						'application/json': { schema: gitProjectBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: gitInitResponseSchema },
					},
				},
				'500': {
					description: 'Error',
					content: {
						'application/json': { schema: gitErrorResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const body = await c.req.json().catch(() => ({}));
				gitStatusSchema.parse(body);
				const requestedPath = await realpath(
					resolve(await resolveRequestProjectRoot(c)),
				);

				const pathStats = await stat(requestedPath);
				if (!pathStats.isDirectory()) {
					return c.json(
						{
							status: 'error',
							error: 'Git repository can only be initialized in a directory',
							code: 'NOT_A_DIRECTORY',
						},
						400,
					);
				}

				const existing = await validateAndGetGitRoot(requestedPath);
				if (!('error' in existing)) {
					return c.json({
						status: 'ok',
						data: { initialized: false, path: existing.gitRoot },
					});
				}

				await execFileAsync('git', ['init'], { cwd: requestedPath });

				return c.json({
					status: 'ok',
					data: { initialized: true, path: requestedPath },
				});
			} catch (error) {
				return c.json(
					{
						status: 'error',
						error:
							error instanceof Error
								? error.message
								: 'Failed to initialize git repository',
					},
					500,
				);
			}
		},
	);
}
