import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	handleDeleteFiles,
	handleRestoreFiles,
	handleStageFiles,
	handleUnstageFiles,
} from './staging-service.ts';

const gitFilesBodySchema = z.object({
	project: z.string().optional(),
	files: z.array(z.string()),
});

const gitErrorResponseSchema = z.object({
	status: z.literal('error'),
	error: z.string(),
	code: z.string().optional(),
});

function gitFilesActionResponseSchema(
	field: 'staged' | 'unstaged' | 'restored' | 'deleted',
) {
	return z.object({
		status: z.literal('ok'),
		data: z.object({
			[field]: z.array(z.string()),
			failed: z.array(z.string()).optional(),
		}),
	});
}

export function registerStagingRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/stage',
			tags: ['git'],
			operationId: 'stageFiles',
			summary: 'Stage files',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: gitFilesBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: gitFilesActionResponseSchema('staged'),
						},
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
		handleStageFiles,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/unstage',
			tags: ['git'],
			operationId: 'unstageFiles',
			summary: 'Unstage files',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: gitFilesBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: gitFilesActionResponseSchema('unstaged'),
						},
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
		handleUnstageFiles,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/restore',
			tags: ['git'],
			operationId: 'restoreFiles',
			summary: 'Restore files to HEAD',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: gitFilesBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: gitFilesActionResponseSchema('restored'),
						},
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
		handleRestoreFiles,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/delete',
			tags: ['git'],
			operationId: 'deleteFiles',
			summary: 'Delete untracked files',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: gitFilesBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: gitFilesActionResponseSchema('deleted'),
						},
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
		handleDeleteFiles,
	);
}
