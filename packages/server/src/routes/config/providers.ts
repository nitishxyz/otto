import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	handleDeleteProviderSettings,
	handleDiscoverProviderModels,
	handleGetProviders,
	handleUpdateProviderSettings,
} from './providers-service.ts';

const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const providerParamsSchema = z.object({
	provider: z.string().openapi({
		param: { name: 'provider', in: 'path' },
	}),
});

const providerDetailSchema = z.object({
	id: z.string(),
	label: z.string(),
	source: z.enum(['built-in', 'custom']),
	enabled: z.boolean(),
	authorized: z.boolean(),
	custom: z.boolean().optional(),
	compatibility: z.string().nullable().optional(),
	family: z.string().nullable().optional(),
	baseURL: z.string().nullable().optional(),
	apiKeyEnv: z.string().nullable().optional(),
	hasApiKey: z.boolean().optional(),
	allowAnyModel: z.boolean().optional(),
	modelCount: z.number().int().optional(),
	authType: z.string().nullable().optional(),
});

const providersResponseSchema = z.object({
	providers: z.array(z.string()),
	details: z.array(providerDetailSchema),
	default: z.string(),
});

const discoveredModelSchema = z.object({
	id: z.string(),
	label: z.string(),
	toolCall: z.boolean().optional(),
	reasoningText: z.boolean().optional(),
	vision: z.boolean().optional(),
	attachment: z.boolean().optional(),
	contextWindow: z.number().optional(),
	maxOutputTokens: z.number().optional(),
});

const discoverProviderModelsBodySchema = z.object({
	compatibility: z.string().optional().openapi({
		description:
			'Provider compatibility mode. Model discovery currently supports ollama.',
	}),
	baseURL: z.string().openapi({
		description: 'Provider base URL to inspect.',
	}),
	apiKey: z.string().optional().openapi({
		description: 'Optional API key for the provider.',
	}),
});

const discoverProviderModelsResponseSchema = z.object({
	baseURL: z.string().optional(),
	models: z.array(discoveredModelSchema),
	unsupported: z.boolean().optional(),
	message: z.string().optional(),
});

const providerCompatibilitySchema = z.enum([
	'openai',
	'anthropic',
	'google',
	'openrouter',
	'ollama',
	'openai-compatible',
]);

const providerPromptFamilySchema = z.enum([
	'default',
	'anthropic',
	'openai',
	'google',
	'kimi',
	'minimax',
	'glm',
	'openai-compatible',
]);

const modelProviderBindingSchema = z.object({
	id: z.string().optional(),
	npm: z.string().optional(),
	compatibility: providerCompatibilitySchema.optional(),
	api: z.string().optional(),
	baseURL: z.string().optional(),
	family: providerPromptFamilySchema.optional(),
});

const providerModelSettingsSchema = z.object({
	id: z.string().optional(),
	ownedBy: z
		.enum([
			'openai',
			'anthropic',
			'google',
			'meta',
			'openrouter',
			'xai',
			'kimi',
			'qwen',
			'zai',
			'deepseek',
			'minimax',
		])
		.optional(),
	label: z.string().optional(),
	toolCall: z.boolean().optional(),
	reasoningText: z.boolean().optional(),
	attachment: z.boolean().optional(),
	temperature: z.union([z.boolean(), z.number()]).optional(),
	limit: z
		.object({
			context: z.number().optional(),
			output: z.number().optional(),
		})
		.optional(),
	provider: modelProviderBindingSchema.optional(),
});

const providerSettingsBodySchema = z.object({
	enabled: z.boolean().optional(),
	custom: z.boolean().optional(),
	label: z.string().optional(),
	compatibility: z.string().optional(),
	family: z.string().optional(),
	baseURL: z.string().nullable().optional(),
	apiKey: z.string().nullable().optional(),
	apiKeyEnv: z.string().nullable().optional(),
	models: z.record(z.string(), providerModelSettingsSchema).optional(),
	allowAnyModel: z.boolean().optional(),
});

const providerSettingsResponseSchema = z.object({
	success: z.boolean(),
	provider: z.string(),
	details: z.array(providerDetailSchema),
});

const providerErrorSchema = z.object({
	error: z.string().optional(),
});

export function registerProvidersRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/providers',
			tags: ['config'],
			operationId: 'getProviders',
			summary: 'Get available providers',
			description: 'Returns only providers that have been authorized',
			request: {
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: providersResponseSchema },
					},
				},
			},
		},
		handleGetProviders,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/config/providers/discover-models',
			tags: ['config'],
			operationId: 'discoverProviderModels',
			summary: 'Discover models for a provider',
			description:
				'Discovers available models from a provider base URL. Currently supports Ollama-compatible providers.',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: discoverProviderModelsBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Discovered provider models',
					content: {
						'application/json': {
							schema: discoverProviderModelsResponseSchema,
						},
					},
				},
				'400': {
					description: 'Invalid discovery request',
					content: {
						'application/json': { schema: providerErrorSchema },
					},
				},
			},
		},
		handleDiscoverProviderModels,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'put',
			path: '/v1/config/providers/{provider}',
			tags: ['config'],
			operationId: 'updateProviderSettings',
			summary: 'Create or update provider settings',
			request: {
				query: projectQuerySchema,
				params: providerParamsSchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: providerSettingsBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: providerSettingsResponseSchema },
					},
				},
			},
		},
		handleUpdateProviderSettings,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/config/providers/{provider}',
			tags: ['config'],
			operationId: 'deleteProviderSettings',
			summary: 'Delete provider override or custom provider entry',
			request: {
				query: projectQuerySchema,
				params: providerParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: providerSettingsResponseSchema },
					},
				},
			},
		},
		handleDeleteProviderSettings,
	);
}
