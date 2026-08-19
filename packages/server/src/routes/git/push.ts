import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { runInteractiveGitCommand } from './interactive.ts';
import { getCurrentBranch, validateAndGetGitRoot } from './utils.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

const execFileAsync = promisify(execFile);

const gitProjectBodySchema = z.object({
	project: z.string().optional(),
	sessionId: z.string().optional(),
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

export function registerPushRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/push',
			tags: ['git'],
			operationId: 'pushCommits',
			summary: 'Push commits to remote',
			description: 'Pushes local commits to the configured remote repository',
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
				const input = c.req.valid('json') ?? {};

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
					const { stdout: remotes } = await execFileAsync('git', ['remote'], {
						cwd: gitRoot,
					});
					if (!remotes.trim()) {
						return c.json(
							{ status: 'error', error: 'No remote repository configured' },
							400,
						);
					}
				} catch {
					return c.json(
						{ status: 'error', error: 'No remote repository configured' },
						400,
					);
				}

				const branch = await getCurrentBranch(gitRoot);
				let hasUpstream = false;
				try {
					await execFileAsync(
						'git',
						['rev-parse', '--abbrev-ref', '@{upstream}'],
						{
							cwd: gitRoot,
						},
					);
					hasUpstream = true;
				} catch {}

				try {
					let pushOutput: string;
					let pushError: string;

					if (hasUpstream) {
						const result = await runInteractiveGitCommand({
							projectRoot: requestedPath,
							sessionId: input.sessionId,
							cwd: gitRoot,
							gitArgs: ['push'],
							operation: 'push',
						});
						pushOutput = result.stdout;
						pushError = result.stderr;
					} else {
						const result = await runInteractiveGitCommand({
							projectRoot: requestedPath,
							sessionId: input.sessionId,
							cwd: gitRoot,
							gitArgs: ['push', '--set-upstream', 'origin', branch],
							operation: 'push',
						});
						pushOutput = result.stdout;
						pushError = result.stderr;
					}

					return c.json({
						status: 'ok',
						data: {
							output: pushOutput.trim() || pushError.trim(),
						},
					});
				} catch (pushErr: unknown) {
					const error = pushErr as {
						message?: string;
						stderr?: string;
						code?: number;
					};
					const errorMessage =
						error.stderr || error.message || 'Failed to push';

					if (
						errorMessage.includes('failed to push') ||
						errorMessage.includes('rejected')
					) {
						return c.json(
							{
								status: 'error',
								error:
									'Push rejected. Try pulling changes first with: git pull',
								details: errorMessage,
							},
							400,
						);
					}

					if (
						errorMessage.includes('Permission denied') ||
						errorMessage.includes('authentication') ||
						errorMessage.includes('could not read')
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

					if (
						errorMessage.includes('Could not resolve host') ||
						errorMessage.includes('network')
					) {
						return c.json(
							{
								status: 'error',
								error: 'Network error. Check your internet connection',
								details: errorMessage,
							},
							503,
						);
					}

					return c.json(
						{
							status: 'error',
							error: 'Failed to push commits',
							details: errorMessage,
						},
						500,
					);
				}
			} catch (error) {
				return c.json(
					{
						status: 'error',
						error: error instanceof Error ? error.message : 'Failed to push',
					},
					500,
				);
			}
		},
	);
}
