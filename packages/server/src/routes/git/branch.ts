import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import {
	getAheadBehind,
	getCurrentBranch,
	validateAndGetGitRoot,
} from './utils.ts';

const execFileAsync = promisify(execFile);

const gitBranchQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const gitBranchResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		branch: z.string().nullable(),
		ahead: z.number(),
		behind: z.number(),
		remotes: z.array(z.string()),
	}),
});

const gitErrorResponseSchema = z.object({
	status: z.literal('error'),
	error: z.string(),
	code: z.string().optional(),
});

export function registerBranchRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/git/branch',
			tags: ['git'],
			operationId: 'getGitBranch',
			summary: 'Get git branch information',
			request: {
				query: gitBranchQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: gitBranchResponseSchema },
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
				const requestedPath = await resolveRequestProjectRoot(c);

				const validation = await validateAndGetGitRoot(requestedPath);
				if ('error' in validation) {
					return c.json(
						{ status: 'error', error: validation.error, code: validation.code },
						400,
					);
				}

				const { gitRoot } = validation;

				const branch = await getCurrentBranch(gitRoot);

				const { ahead, behind } = await getAheadBehind(gitRoot);

				try {
					const { stdout: remotes } = await execFileAsync('git', ['remote'], {
						cwd: gitRoot,
					});
					const remoteList = remotes.trim().split('\n').filter(Boolean);

					return c.json({
						status: 'ok',
						data: {
							branch,
							ahead,
							behind,
							remotes: remoteList,
						},
					});
				} catch {
					return c.json({
						status: 'ok',
						data: {
							branch,
							ahead,
							behind,
							remotes: [],
						},
					});
				}
			} catch (error) {
				return c.json(
					{
						status: 'error',
						error:
							error instanceof Error
								? error.message
								: 'Failed to get branch info',
					},
					500,
				);
			}
		},
	);
}
