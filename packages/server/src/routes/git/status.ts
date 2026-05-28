import type { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitStatusSchema } from './schemas.ts';
import {
	validateAndGetGitRoot,
	parseGitStatus,
	getAheadBehind,
	getHeadInfo,
	getGitOperationState,
} from './utils.ts';
import { openApiRoute } from '../../openapi/route.ts';

const execFileAsync = promisify(execFile);

export function registerStatusRoute(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/git/status',
			tags: ['git'],
			operationId: 'getGitStatus',
			summary: 'Get git status',
			description:
				'Returns current git status including staged, unstaged, and untracked files',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									status: {
										type: 'string',
										enum: ['ok'],
									},
									data: {
										$ref: '#/components/schemas/GitStatus',
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
									status: {
										type: 'string',
										enum: ['error'],
									},
									error: {
										type: 'string',
									},
									code: {
										type: 'string',
									},
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
									status: {
										type: 'string',
										enum: ['error'],
									},
									error: {
										type: 'string',
									},
									code: {
										type: 'string',
									},
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
				const query = gitStatusSchema.parse({
					project: c.req.query('project'),
				});

				const requestedPath = query.project || process.cwd();

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
