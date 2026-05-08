import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import {
	handleDeleteProviderSettings,
	handleDiscoverProviderModels,
	handleGetProviders,
	handleUpdateProviderSettings,
} from './providers-service.ts';

export function registerProvidersRoute(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/providers',
			tags: ['config'],
			operationId: 'getProviders',
			summary: 'Get available providers',
			description: 'Returns only providers that have been authorized',
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
									providers: {
										type: 'array',
										items: {
											$ref: '#/components/schemas/Provider',
										},
									},
									details: {
										type: 'array',
										items: {
											$ref: '#/components/schemas/ProviderDetail',
										},
									},
									default: {
										$ref: '#/components/schemas/Provider',
									},
								},
								required: ['providers', 'details', 'default'],
							},
						},
					},
				},
			},
		},
		handleGetProviders,
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/config/providers/discover-models',
			tags: ['config'],
			operationId: 'discoverProviderModels',
			summary: 'Discover models for a provider',
			description:
				'Discovers available models from a provider base URL. Currently supports Ollama-compatible providers.',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								compatibility: {
									type: 'string',
									description:
										'Provider compatibility mode. Model discovery currently supports ollama.',
								},
								baseURL: {
									type: 'string',
									description: 'Provider base URL to inspect.',
								},
								apiKey: {
									type: 'string',
									description: 'Optional API key for the provider.',
								},
							},
							required: ['baseURL'],
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'Discovered provider models',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									baseURL: { type: 'string' },
									models: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												id: { type: 'string' },
												label: { type: 'string' },
												toolCall: { type: 'boolean' },
												reasoningText: { type: 'boolean' },
												vision: { type: 'boolean' },
												attachment: { type: 'boolean' },
												contextWindow: { type: 'number' },
												maxOutputTokens: { type: 'number' },
											},
											required: ['id', 'label'],
										},
									},
									unsupported: { type: 'boolean' },
									message: { type: 'string' },
								},
								required: ['models'],
							},
						},
					},
				},
				'400': { description: 'Invalid discovery request' },
			},
		},
		handleDiscoverProviderModels,
	);

	openApiRoute(
		app,
		{
			method: 'put',
			path: '/v1/config/providers/{provider}',
			tags: ['config'],
			operationId: 'updateProviderSettings',
			summary: 'Create or update provider settings',
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
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								enabled: {
									type: 'boolean',
								},
								custom: {
									type: 'boolean',
								},
								label: {
									type: 'string',
								},
								compatibility: {
									type: 'string',
								},
								family: {
									type: 'string',
								},
								baseURL: {
									type: 'string',
									nullable: true,
								},
								apiKey: {
									type: 'string',
									nullable: true,
								},
								apiKeyEnv: {
									type: 'string',
									nullable: true,
								},
								models: {
									type: 'array',
									items: {
										type: 'string',
									},
								},
								allowAnyModel: {
									type: 'boolean',
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
									success: {
										type: 'boolean',
									},
									provider: {
										$ref: '#/components/schemas/Provider',
									},
									details: {
										type: 'array',
										items: {
											$ref: '#/components/schemas/ProviderDetail',
										},
									},
								},
								required: ['success', 'provider', 'details'],
							},
						},
					},
				},
			},
		},
		handleUpdateProviderSettings,
	);

	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/config/providers/{provider}',
			tags: ['config'],
			operationId: 'deleteProviderSettings',
			summary: 'Delete provider override or custom provider entry',
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
									success: {
										type: 'boolean',
									},
									provider: {
										$ref: '#/components/schemas/Provider',
									},
									details: {
										type: 'array',
										items: {
											$ref: '#/components/schemas/ProviderDetail',
										},
									},
								},
								required: ['success', 'provider', 'details'],
							},
						},
					},
				},
			},
		},
		handleDeleteProviderSettings,
	);
}
