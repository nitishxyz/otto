import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import {
	handleCommitChanges,
	handleGenerateCommitMessage,
} from './commit-service.ts';

export function registerCommitRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/commit',
			tags: ['git'],
			operationId: 'commitChanges',
			summary: 'Commit staged changes',
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
								message: {
									type: 'string',
									minLength: 1,
								},
							},
							required: ['message'],
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
										$ref: '#/components/schemas/GitCommit',
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
		handleCommitChanges,
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/git/generate-commit-message',
			tags: ['git'],
			operationId: 'generateCommitMessage',
			summary: 'Generate AI-powered commit message',
			description:
				'Uses AI to generate a commit message based on staged changes',
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
								sessionId: {
									type: 'string',
									description: 'Session ID to use session provider',
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
											message: {
												type: 'string',
											},
										},
										required: ['message'],
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
		handleGenerateCommitMessage,
	);
}
