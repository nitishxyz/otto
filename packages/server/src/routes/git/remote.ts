import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	handleAddGitRemote,
	handleGetGitRemotes,
	handleRemoveGitRemote,
} from './remote-service.ts';

const gitProjectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const gitRemoteBodySchema = z.object({
	project: z.string().optional(),
	name: z.string(),
	url: z.string(),
});

const gitRemoteRemoveBodySchema = z.object({
	project: z.string().optional(),
	name: z.string(),
});

const gitRemoteSchema = z.object({
	name: z.string(),
	url: z.string(),
	type: z.string(),
});

const gitRemotesResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		remotes: z.array(gitRemoteSchema),
	}),
});

const gitRemoteAddedResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		name: z.string(),
		url: z.string(),
	}),
});

const gitRemoteRemovedResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		removed: z.string(),
	}),
});

const gitErrorResponseSchema = z.object({
	status: z.literal('error'),
	error: z.string(),
	code: z.string().optional(),
});

export function registerRemoteRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/git/remotes',
			tags: ['git'],
			operationId: 'getGitRemotes',
			summary: 'List git remotes',
			request: {
				query: gitProjectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: gitRemotesResponseSchema },
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
		handleGetGitRemotes,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/remotes',
			tags: ['git'],
			operationId: 'addGitRemote',
			summary: 'Add a git remote',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: gitRemoteBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: gitRemoteAddedResponseSchema },
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
		handleAddGitRemote,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/git/remotes',
			tags: ['git'],
			operationId: 'removeGitRemote',
			summary: 'Remove a git remote',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: gitRemoteRemoveBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: gitRemoteRemovedResponseSchema },
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
		handleRemoveGitRemote,
	);
}
