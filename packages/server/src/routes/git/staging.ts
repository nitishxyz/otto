import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import {
	handleDeleteFiles,
	handleRestoreFiles,
	handleStageFiles,
	handleUnstageFiles,
} from './staging-service.ts';

export function registerStagingRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/stage',
			tags: ['git'],
			operationId: 'stageFiles',
			summary: 'Stage files',
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
								files: {
									type: 'array',
									items: {
										type: 'string',
									},
								},
							},
							required: ['files'],
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
											staged: {
												type: 'array',
												items: {
													type: 'string',
												},
											},
											failed: {
												type: 'array',
												items: {
													type: 'string',
												},
											},
										},
										required: ['staged', 'failed'],
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
		handleStageFiles,
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/unstage',
			tags: ['git'],
			operationId: 'unstageFiles',
			summary: 'Unstage files',
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
								files: {
									type: 'array',
									items: {
										type: 'string',
									},
								},
							},
							required: ['files'],
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
											unstaged: {
												type: 'array',
												items: {
													type: 'string',
												},
											},
											failed: {
												type: 'array',
												items: {
													type: 'string',
												},
											},
										},
										required: ['unstaged', 'failed'],
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
		handleUnstageFiles,
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/restore',
			tags: ['git'],
			operationId: 'restoreFiles',
			summary: 'Restore files to HEAD',
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
								files: {
									type: 'array',
									items: {
										type: 'string',
									},
								},
							},
							required: ['files'],
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
											restored: {
												type: 'array',
												items: {
													type: 'string',
												},
											},
										},
										required: ['restored'],
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
		handleRestoreFiles,
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/delete',
			tags: ['git'],
			operationId: 'deleteFiles',
			summary: 'Delete untracked files',
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
								files: {
									type: 'array',
									items: {
										type: 'string',
									},
								},
							},
							required: ['files'],
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
											deleted: {
												type: 'array',
												items: {
													type: 'string',
												},
											},
										},
										required: ['deleted'],
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
		handleDeleteFiles,
	);
}
