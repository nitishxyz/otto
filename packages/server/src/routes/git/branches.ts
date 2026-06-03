import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	handleCheckoutBranch,
	handleCreateBranch,
	handleListBranches,
} from './branches-service.ts';

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

const gitErrorResponseSchema = z.object({
	status: z.literal('error'),
	error: z.string(),
	code: z.string().optional(),
});

const branchItemSchema = z.object({
	name: z.string(),
	fullName: z.string(),
	current: z.boolean(),
	remote: z.boolean(),
	remoteName: z.string().optional(),
	upstream: z.string().optional(),
	sha: z.string().optional(),
	subject: z.string().optional(),
});

const listBranchesResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		current: z.string(),
		branches: z.array(branchItemSchema),
	}),
});

const checkoutBranchBodySchema = z.object({
	project: z.string().optional(),
	branch: z.string(),
});

const checkoutBranchResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		branch: z.string(),
	}),
});

const createBranchBodySchema = z.object({
	project: z.string().optional(),
	name: z.string(),
	startPoint: z.string().optional(),
	checkout: z.boolean().optional(),
});

const createBranchResponseSchema = z.object({
	status: z.literal('ok'),
	data: z.object({
		branch: z.string(),
		checkedOut: z.boolean(),
	}),
});

export function registerBranchesRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/git/branches',
			tags: ['git'],
			operationId: 'listGitBranches',
			summary: 'List local and remote git branches',
			request: {
				query: gitProjectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: listBranchesResponseSchema },
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
		handleListBranches,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/checkout',
			tags: ['git'],
			operationId: 'checkoutGitBranch',
			summary: 'Switch to an existing git branch',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: checkoutBranchBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: checkoutBranchResponseSchema },
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
		handleCheckoutBranch,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/branches',
			tags: ['git'],
			operationId: 'createGitBranch',
			summary: 'Create a new git branch (optionally checking it out)',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: createBranchBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: createBranchResponseSchema },
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
		handleCreateBranch,
	);
}
