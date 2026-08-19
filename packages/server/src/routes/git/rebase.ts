import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { getGitOperationState, validateAndGetGitRoot } from './utils.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

const execFileAsync = promisify(execFile);

const REBASE_ACTION_ARGS = {
	continue: '--continue',
	abort: '--abort',
	skip: '--skip',
} as const;

const gitRebaseActionSchema = z.enum(['continue', 'abort', 'skip']);

const gitRebaseBodySchema = z.object({
	project: z.string().optional(),
	action: gitRebaseActionSchema,
});

const gitRebaseResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		action: gitRebaseActionSchema,
		output: z.string(),
	}),
});

const gitErrorResponseSchema = z.object({
	status: z.literal('error'),
	error: z.string(),
	code: z.string().optional(),
});

export function registerRebaseRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/rebase',
			tags: ['git'],
			operationId: 'performGitRebaseAction',
			summary: 'Perform a git rebase action',
			description:
				'Runs git rebase --continue, --abort, or --skip for an in-progress rebase.',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: gitRebaseBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: gitRebaseResponseSchema },
					},
				},
				'400': {
					description: 'Error',
					content: {
						'application/json': { schema: gitErrorResponseSchema },
					},
				},
				'409': {
					description: 'No rebase is currently in progress',
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
				const { action } = c.req.valid('json');
				const requestedPath = await resolveRequestProjectRoot(c);

				const validation = await validateAndGetGitRoot(requestedPath);
				if ('error' in validation) {
					return c.json(
						{ status: 'error', error: validation.error, code: validation.code },
						400,
					);
				}

				const operation = await getGitOperationState(validation.gitRoot);
				if (!operation?.type.startsWith('rebase')) {
					return c.json(
						{
							status: 'error',
							error: 'No rebase is currently in progress',
							code: 'NO_REBASE_IN_PROGRESS',
						},
						409,
					);
				}

				const { stdout, stderr } = await execFileAsync(
					'git',
					['rebase', REBASE_ACTION_ARGS[action]],
					{
						cwd: validation.gitRoot,
						env: {
							...process.env,
							GIT_EDITOR: 'true',
							GIT_SEQUENCE_EDITOR: 'true',
						},
					},
				);

				return c.json({
					status: 'ok',
					data: { action, output: `${stdout}${stderr}`.trim() },
				});
			} catch (error) {
				return c.json(
					{
						status: 'error',
						error:
							error instanceof Error
								? error.message
								: 'Failed to perform rebase action',
					},
					500,
				);
			}
		},
	);
}
