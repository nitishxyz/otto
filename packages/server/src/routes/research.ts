import type { Hono } from 'hono';
import { openApiRoute } from '../openapi/route.ts';
import {
	createResearchSession,
	deleteResearchSession,
	exportResearchSession,
	injectResearchContext,
	listResearchSessions,
} from './research/service.ts';

export function registerResearchRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{parentId}/research',
			tags: ['sessions'],
			operationId: 'listResearchSessions',
			summary: 'List research sessions for a parent',
			parameters: [
				{
					in: 'path',
					name: 'parentId',
					required: true,
					schema: {
						type: 'string',
					},
				},
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
									sessions: {
										type: 'array',
										items: {
											$ref: '#/components/schemas/Session',
										},
									},
								},
								required: ['sessions'],
							},
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
			},
		},
		listResearchSessions,
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{parentId}/research',
			tags: ['sessions'],
			operationId: 'createResearchSession',
			summary: 'Create a research session',
			parameters: [
				{
					in: 'path',
					name: 'parentId',
					required: true,
					schema: {
						type: 'string',
					},
				},
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
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								provider: {
									type: 'string',
								},
								model: {
									type: 'string',
								},
								title: {
									type: 'string',
								},
							},
						},
					},
				},
			},
			responses: {
				'201': {
					description: 'Created',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									session: {
										$ref: '#/components/schemas/Session',
									},
									parentSessionId: {
										type: 'string',
									},
								},
								required: ['session', 'parentSessionId'],
							},
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
			},
		},
		createResearchSession,
	);

	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/research/{researchId}',
			tags: ['sessions'],
			operationId: 'deleteResearchSession',
			summary: 'Delete a research session',
			parameters: [
				{
					in: 'path',
					name: 'researchId',
					required: true,
					schema: {
						type: 'string',
					},
				},
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
									success: {
										type: 'boolean',
									},
								},
								required: ['success'],
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
			},
		},
		deleteResearchSession,
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{parentId}/inject',
			tags: ['sessions'],
			operationId: 'injectResearchContext',
			summary: 'Inject research context into parent session',
			parameters: [
				{
					in: 'path',
					name: 'parentId',
					required: true,
					schema: {
						type: 'string',
					},
				},
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
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								researchSessionId: {
									type: 'string',
								},
								label: {
									type: 'string',
								},
							},
							required: ['researchSessionId'],
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
									content: {
										type: 'string',
									},
									label: {
										type: 'string',
									},
									sessionId: {
										type: 'string',
									},
									parentSessionId: {
										type: 'string',
									},
									tokenEstimate: {
										type: 'integer',
									},
								},
								required: [
									'content',
									'label',
									'sessionId',
									'parentSessionId',
									'tokenEstimate',
								],
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
			},
		},
		injectResearchContext,
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/research/{researchId}/export',
			tags: ['sessions'],
			operationId: 'exportResearchSession',
			summary: 'Export research session to a new main session',
			parameters: [
				{
					in: 'path',
					name: 'researchId',
					required: true,
					schema: {
						type: 'string',
					},
				},
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
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								provider: {
									type: 'string',
								},
								model: {
									type: 'string',
								},
								agent: {
									type: 'string',
								},
							},
						},
					},
				},
			},
			responses: {
				'201': {
					description: 'Created',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									newSession: {
										$ref: '#/components/schemas/Session',
									},
									injectedContext: {
										type: 'string',
									},
								},
								required: ['newSession', 'injectedContext'],
							},
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
			},
		},
		exportResearchSession,
	);
}
