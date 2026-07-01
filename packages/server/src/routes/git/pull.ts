import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { gitPullSchema } from './schemas.ts';
import { validateAndGetGitRoot } from './utils.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

const execFileAsync = promisify(execFile);

const gitProjectBodySchema = z.object({
	project: z.string().optional(),
});

const gitOutputResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		output: z.string(),
	}),
});

const gitErrorResponseSchema = z.object({
	status: z.literal('error'),
	error: z.string(),
	code: z.string().optional(),
	details: z.string().optional(),
});

export function registerPullRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/pull',
			tags: ['git'],
			operationId: 'pullChanges',
			summary: 'Pull changes from remote',
			description: 'Pulls changes from the configured remote repository',
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
						'application/json': { schema: gitOutputResponseSchema },
					},
				},
				'400': {
					description: 'Error',
					content: {
						'application/json': { schema: gitErrorResponseSchema },
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
				let body = {};
				try {
					body = await c.req.json();
				} catch {
					body = {};
				}

				gitPullSchema.parse(body);

				const requestedPath = await resolveRequestProjectRoot(c);

				const validation = await validateAndGetGitRoot(requestedPath);
				if ('error' in validation) {
					return c.json(
						{ status: 'error', error: validation.error, code: validation.code },
						400,
					);
				}

				const { gitRoot } = validation;

				try {
					const result = await execFileAsync('git', ['pull'], {
						cwd: gitRoot,
					});

					return c.json({
						status: 'ok',
						data: {
							output: result.stdout.trim() || result.stderr.trim(),
						},
					});
				} catch (pullErr: unknown) {
					const error = pullErr as {
						message?: string;
						stderr?: string;
					};
					const errorMessage =
						error.stderr || error.message || 'Failed to pull';

					if (
						errorMessage.includes('CONFLICT') ||
						errorMessage.includes('merge conflict')
					) {
						return c.json(
							{
								status: 'error',
								error: 'Merge conflicts detected. Resolve conflicts manually',
								details: errorMessage,
							},
							400,
						);
					}

					if (
						errorMessage.includes('Permission denied') ||
						errorMessage.includes('authentication')
					) {
						return c.json(
							{
								status: 'error',
								error: 'Authentication failed. Check your git credentials',
								details: errorMessage,
							},
							401,
						);
					}

					return c.json(
						{
							status: 'error',
							error: 'Failed to pull changes',
							details: errorMessage,
						},
						500,
					);
				}
			} catch (error) {
				return c.json(
					{
						status: 'error',
						error: error instanceof Error ? error.message : 'Failed to pull',
					},
					500,
				);
			}
		},
	);
}
