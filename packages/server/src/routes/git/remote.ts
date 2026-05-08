import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import {
	handleAddGitRemote,
	handleGetGitRemotes,
	handleRemoveGitRemote,
} from './remote-service.ts';

export function registerRemoteRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/git/remotes',
			tags: ['git'],
			operationId: 'getGitRemotes',
			summary: 'List git remotes',
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
										type: 'object',
										properties: {
											remotes: {
												type: 'array',
												items: {
													type: 'object',
													properties: {
														name: {
															type: 'string',
														},
														url: {
															type: 'string',
														},
														type: {
															type: 'string',
														},
													},
													required: ['name', 'url', 'type'],
												},
											},
										},
										required: ['remotes'],
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
		handleGetGitRemotes,
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/remotes',
			tags: ['git'],
			operationId: 'addGitRemote',
			summary: 'Add a git remote',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								project: {
									type: 'string',
								},
								name: {
									type: 'string',
								},
								url: {
									type: 'string',
								},
							},
							required: ['name', 'url'],
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
											name: {
												type: 'string',
											},
											url: {
												type: 'string',
											},
										},
										required: ['name', 'url'],
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
		handleAddGitRemote,
	);

	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/git/remotes',
			tags: ['git'],
			operationId: 'removeGitRemote',
			summary: 'Remove a git remote',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								project: {
									type: 'string',
								},
								name: {
									type: 'string',
								},
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
									status: {
										type: 'string',
										enum: ['ok'],
									},
									data: {
										type: 'object',
										properties: {
											removed: {
												type: 'string',
											},
										},
										required: ['removed'],
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
		handleRemoveGitRemote,
	);
}
