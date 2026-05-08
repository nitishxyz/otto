import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import {
	handleGetAllModels,
	handleGetProviderModels,
} from './models-service.ts';

export function registerModelsRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/providers/{provider}/models',
			tags: ['config'],
			operationId: 'getProviderModels',
			summary: 'Get available models for a provider',
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
				{
					in: 'path',
					name: 'provider',
					required: true,
					schema: {
						$ref: '#/components/schemas/Provider',
					},
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
									models: {
										type: 'array',
										items: {
											$ref: '#/components/schemas/Model',
										},
									},
									default: {
										type: 'string',
										nullable: true,
									},
									allowAnyModel: {
										type: 'boolean',
									},
									label: {
										type: 'string',
									},
								},
								required: ['models', 'allowAnyModel', 'label'],
							},
						},
					},
				},
				'403': {
					description: 'Provider not authorized',
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
					description: 'Provider not found',
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
		handleGetProviderModels,
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/models',
			tags: ['config'],
			operationId: 'getAllModels',
			summary: 'Get all models across authorized providers',
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
								additionalProperties: {
									type: 'object',
									properties: {
										label: {
											type: 'string',
										},
										authType: {
											type: 'string',
										},
										models: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													id: {
														type: 'string',
													},
													label: {
														type: 'string',
													},
													toolCall: {
														type: 'boolean',
													},
													reasoningText: {
														type: 'boolean',
													},
													vision: {
														type: 'boolean',
													},
													attachment: {
														type: 'boolean',
													},
												},
												required: ['id', 'label'],
											},
										},
									},
									required: ['label', 'models'],
								},
							},
						},
					},
				},
			},
		},
		handleGetAllModels,
	);
}
