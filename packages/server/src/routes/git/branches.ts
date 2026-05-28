import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import {
	handleCheckoutBranch,
	handleCreateBranch,
	handleListBranches,
} from './branches-service.ts';

const errorResponse = {
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
} as const;

const branchItemSchema = {
	type: 'object',
	properties: {
		name: { type: 'string' },
		fullName: { type: 'string' },
		current: { type: 'boolean' },
		remote: { type: 'boolean' },
		remoteName: { type: 'string' },
		upstream: { type: 'string' },
		sha: { type: 'string' },
		subject: { type: 'string' },
	},
	required: ['name', 'fullName', 'current', 'remote'],
} as const;

export function registerBranchesRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/git/branches',
			tags: ['git'],
			operationId: 'listGitBranches',
			summary: 'List local and remote git branches',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: { type: 'string' },
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
									status: { type: 'string', enum: ['ok'] },
									data: {
										type: 'object',
										properties: {
											current: { type: 'string' },
											branches: {
												type: 'array',
												items: branchItemSchema,
											},
										},
										required: ['current', 'branches'],
									},
								},
								required: ['status', 'data'],
							},
						},
					},
				},
				'400': errorResponse,
				'500': errorResponse,
			},
		},
		handleListBranches,
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/checkout',
			tags: ['git'],
			operationId: 'checkoutGitBranch',
			summary: 'Switch to an existing git branch',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								project: { type: 'string' },
								branch: { type: 'string' },
							},
							required: ['branch'],
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
											branch: { type: 'string' },
										},
										required: ['branch'],
									},
								},
								required: ['status', 'data'],
							},
						},
					},
				},
				'400': errorResponse,
				'500': errorResponse,
			},
		},
		handleCheckoutBranch,
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/branches',
			tags: ['git'],
			operationId: 'createGitBranch',
			summary: 'Create a new git branch (optionally checking it out)',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								project: { type: 'string' },
								name: { type: 'string' },
								startPoint: { type: 'string' },
								checkout: { type: 'boolean' },
							},
							required: ['name'],
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
											branch: { type: 'string' },
											checkedOut: { type: 'boolean' },
										},
										required: ['branch', 'checkedOut'],
									},
								},
								required: ['status', 'data'],
							},
						},
					},
				},
				'400': errorResponse,
				'500': errorResponse,
			},
		},
		handleCreateBranch,
	);
}
