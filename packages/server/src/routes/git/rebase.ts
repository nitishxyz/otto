import type { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitRebaseSchema } from './schemas.ts';
import { getGitOperationState, validateAndGetGitRoot } from './utils.ts';
import { openApiRoute } from '../../openapi/route.ts';

const execFileAsync = promisify(execFile);

const REBASE_ACTION_ARGS = {
	continue: '--continue',
	abort: '--abort',
	skip: '--skip',
} as const;

export function registerRebaseRoute(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/rebase',
			tags: ['git'],
			operationId: 'performGitRebaseAction',
			summary: 'Perform a git rebase action',
			description:
				'Runs git rebase --continue, --abort, or --skip for an in-progress rebase.',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								project: { type: 'string' },
								action: {
									type: 'string',
									enum: ['continue', 'abort', 'skip'],
								},
							},
							required: ['action'],
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									status: { type: 'string', enum: ['ok'] },
									data: {
										type: 'object',
										properties: {
											action: {
												type: 'string',
												enum: ['continue', 'abort', 'skip'],
											},
											output: { type: 'string' },
										},
										required: ['action', 'output'],
									},
								},
								required: ['status', 'data'],
							},
						},
					},
				},
				'400': {
					description: 'Error',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									status: { type: 'string', enum: ['error'] },
									error: { type: 'string' },
									code: { type: 'string' },
								},
								required: ['status', 'error'],
							},
						},
					},
				},
				'409': {
					description: 'No rebase is currently in progress',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									status: { type: 'string', enum: ['error'] },
									error: { type: 'string' },
									code: { type: 'string' },
								},
								required: ['status', 'error'],
							},
						},
					},
				},
				'500': {
					description: 'Error',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									status: { type: 'string', enum: ['error'] },
									error: { type: 'string' },
									code: { type: 'string' },
								},
								required: ['status', 'error'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const body = await c.req.json().catch(() => ({}));
				const { project, action } = gitRebaseSchema.parse(body);
				const requestedPath = project || process.cwd();

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
