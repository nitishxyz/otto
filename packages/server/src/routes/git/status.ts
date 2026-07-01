import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import {
	getAheadBehind,
	getGitOperationState,
	getHeadInfo,
	parseGitStatus,
	validateAndGetGitRoot,
} from './utils.ts';

const execFileAsync = promisify(execFile);

const gitStatusQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const gitFileSchema = z
	.object({
		path: z.string(),
		absPath: z.string(),
		status: z.enum([
			'modified',
			'added',
			'deleted',
			'renamed',
			'untracked',
			'conflicted',
		]),
		staged: z.boolean(),
		insertions: z.number().optional(),
		deletions: z.number().optional(),
		oldPath: z.string().optional(),
		isNew: z.boolean(),
		conflictType: z
			.enum([
				'both-modified',
				'deleted-by-us',
				'deleted-by-them',
				'both-added',
				'both-deleted',
			])
			.optional(),
	})
	.passthrough();

const gitStatusResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		branch: z.string().nullable(),
		headSha: z.string().nullable(),
		shortHeadSha: z.string().nullable(),
		isDetached: z.boolean(),
		operation: z
			.object({
				type: z.string(),
				label: z.string(),
				current: z.number().optional(),
				total: z.number().optional(),
				headName: z.string().optional(),
				onto: z.string().optional(),
			})
			.nullable(),
		ahead: z.number(),
		behind: z.number(),
		hasUpstream: z.boolean(),
		remotes: z.array(z.string()),
		gitRoot: z.string(),
		workingDir: z.string(),
		staged: z.array(gitFileSchema),
		unstaged: z.array(gitFileSchema),
		untracked: z.array(gitFileSchema),
		conflicted: z.array(gitFileSchema),
		hasChanges: z.boolean(),
		hasConflicts: z.boolean(),
	}),
});

const gitErrorResponseSchema = z.object({
	status: z.literal('error'),
	error: z.string(),
	code: z.string().optional(),
});

export function registerStatusRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/git/status',
			tags: ['git'],
			operationId: 'getGitStatus',
			summary: 'Get git status',
			description:
				'Returns current git status including staged, unstaged, and untracked files',
			request: {
				query: gitStatusQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: gitStatusResponseSchema },
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

				const { stdout: statusOutput } = await execFileAsync(
					'git',
					['status', '--porcelain=v2', '--untracked-files=all'],
					{ cwd: gitRoot },
				);

				const { staged, unstaged, untracked, conflicted } = parseGitStatus(
					statusOutput,
					gitRoot,
				);

				const [{ ahead, behind }, headInfo, operation] = await Promise.all([
					getAheadBehind(gitRoot),
					getHeadInfo(gitRoot),
					getGitOperationState(gitRoot),
				]);

				let hasUpstream = false;
				try {
					await execFileAsync(
						'git',
						['rev-parse', '--abbrev-ref', '@{upstream}'],
						{ cwd: gitRoot },
					);
					hasUpstream = true;
				} catch {}

				let remotes: string[] = [];
				try {
					const { stdout: remotesOutput } = await execFileAsync(
						'git',
						['remote'],
						{ cwd: gitRoot },
					);
					remotes = remotesOutput.trim().split('\n').filter(Boolean);
				} catch {}

				const hasChanges =
					staged.length > 0 ||
					unstaged.length > 0 ||
					untracked.length > 0 ||
					conflicted.length > 0;

				const hasConflicts = conflicted.length > 0;

				return c.json({
					status: 'ok',
					data: {
						branch: headInfo.branch,
						headSha: headInfo.headSha,
						shortHeadSha: headInfo.shortHeadSha,
						isDetached: headInfo.isDetached,
						operation,
						ahead,
						behind,
						hasUpstream,
						remotes,
						gitRoot,
						workingDir: requestedPath,
						staged,
						unstaged,
						untracked,
						conflicted,
						hasChanges,
						hasConflicts,
					},
				});
			} catch (error) {
				return c.json(
					{
						status: 'error',
						error:
							error instanceof Error ? error.message : 'Failed to get status',
					},
					500,
				);
			}
		},
	);
}
