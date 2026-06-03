import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { gitDiffSchema } from './schemas.ts';
import {
	checkIfNewFile,
	inferLanguage,
	summarizeDiff,
	validateAndGetGitRoot,
} from './utils.ts';

const execFileAsync = promisify(execFile);

const gitDiffQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
	file: z.string().openapi({
		param: { name: 'file', in: 'query' },
		description: 'File path to get diff for',
	}),
	staged: z
		.enum(['true', 'false'])
		.optional()
		.openapi({
			param: { name: 'staged', in: 'query' },
			description: 'Show staged diff (default: unstaged)',
		}),
	fullFile: z
		.enum(['true', 'false'])
		.optional()
		.openapi({
			param: { name: 'fullFile', in: 'query' },
			description: 'Include full file content in diff',
		}),
});

const gitDiffResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		file: z.string(),
		absPath: z.string(),
		diff: z.string(),
		content: z.string().optional(),
		fullFile: z.boolean().optional(),
		isNewFile: z.boolean(),
		isBinary: z.boolean(),
		insertions: z.number(),
		deletions: z.number(),
		language: z.string(),
		staged: z.boolean(),
	}),
});

const gitErrorResponseSchema = z.object({
	status: z.literal('error'),
	error: z.string(),
	code: z.string().optional(),
});

export function registerDiffRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/git/diff',
			tags: ['git'],
			operationId: 'getGitDiff',
			summary: 'Get git diff for a file',
			request: {
				query: gitDiffQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: gitDiffResponseSchema },
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
				const query = gitDiffSchema.parse({
					project: c.req.query('project'),
					file: c.req.query('file'),
					staged: c.req.query('staged'),
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
				const absPath = join(gitRoot, query.file);

				const isNewFile = await checkIfNewFile(gitRoot, query.file);

				if (isNewFile) {
					try {
						const content = await readFile(absPath, 'utf-8');
						const lineCount = content.split('\n').length;
						const language = inferLanguage(query.file);

						return c.json({
							status: 'ok',
							data: {
								file: query.file,
								absPath,
								diff: '',
								content,
								isNewFile: true,
								isBinary: false,
								insertions: lineCount,
								deletions: 0,
								language,
								staged: !!query.staged,
							},
						});
					} catch (error) {
						return c.json(
							{
								status: 'error',
								error:
									error instanceof Error
										? error.message
										: 'Failed to read file',
							},
							500,
						);
					}
				}

				const diffArgs = query.staged
					? ['diff', '--cached', '--', query.file]
					: ['diff', '--', query.file];

				const fullFile = c.req.query('fullFile') === 'true';
				if (fullFile) {
					diffArgs.splice(1, 0, '-U99999');
				}

				const numstatArgs = query.staged
					? ['diff', '--cached', '--numstat', '--', query.file]
					: ['diff', '--numstat', '--', query.file];

				const [{ stdout: diffOutput }, { stdout: numstatOutput }] =
					await Promise.all([
						execFileAsync('git', diffArgs, { cwd: gitRoot }),
						execFileAsync('git', numstatArgs, { cwd: gitRoot }),
					]);

				let insertions = 0;
				let deletions = 0;
				let binary = false;

				const numstatLine = numstatOutput.trim().split('\n').find(Boolean);
				if (numstatLine) {
					const [rawInsertions, rawDeletions] = numstatLine.split('\t');
					if (rawInsertions === '-' || rawDeletions === '-') {
						binary = true;
					} else {
						insertions = Number.parseInt(rawInsertions, 10) || 0;
						deletions = Number.parseInt(rawDeletions, 10) || 0;
					}
				}

				const diffText = diffOutput ?? '';
				if (!binary) {
					const summary = summarizeDiff(diffText);
					binary = summary.binary;
					if (insertions === 0 && deletions === 0) {
						insertions = summary.insertions;
						deletions = summary.deletions;
					}
				}

				const language = inferLanguage(query.file);

				return c.json({
					status: 'ok',
					data: {
						file: query.file,
						absPath,
						diff: diffText,
						fullFile,
						isNewFile: false,
						isBinary: binary,
						insertions,
						deletions,
						language,
						staged: !!query.staged,
					},
				});
			} catch (error) {
				return c.json(
					{
						status: 'error',
						error:
							error instanceof Error ? error.message : 'Failed to get diff',
					},
					500,
				);
			}
		},
	);
}
