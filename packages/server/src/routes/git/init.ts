import type { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { gitStatusSchema } from './schemas.ts';
import { validateAndGetGitRoot } from './utils.ts';
import { openApiRoute } from '../../openapi/route.ts';

const execFileAsync = promisify(execFile);

export function registerInitRoute(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/init',
			tags: ['git'],
			operationId: 'initGitRepo',
			summary: 'Initialize a git repository',
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								project: {
									type: 'string',
								},
							},
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
									status: {
										type: 'string',
										enum: ['ok'],
									},
									data: {
										type: 'object',
										properties: {
											initialized: {
												type: 'boolean',
											},
											path: {
												type: 'string',
											},
										},
										required: ['initialized', 'path'],
									},
								},
								required: ['status', 'data'],
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
				const body = await c.req.json().catch(() => ({}));
				const { project } = gitStatusSchema.parse(body);
				const requestedPath = await realpath(resolve(project || process.cwd()));

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
