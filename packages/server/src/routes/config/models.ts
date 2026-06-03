import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	handleGetAllModels,
	handleGetProviderModels,
} from './models-service.ts';

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

const providerModelsParamsSchema = z.object({
	provider: z.string().openapi({
		param: { name: 'provider', in: 'path' },
	}),
});

const modelSchema = z.object({
	id: z.string(),
	label: z.string(),
	toolCall: z.boolean().optional(),
	reasoningText: z.boolean().optional(),
	vision: z.boolean().optional(),
	attachment: z.boolean().optional(),
});

const providerModelsResponseSchema = z.object({
	models: z.array(modelSchema),
	default: z.string().nullable().optional(),
	allowAnyModel: z.boolean(),
	label: z.string(),
});

const providerModelsErrorSchema = z.object({
	error: z.string(),
});

const allModelsResponseSchema = z.record(
	z.string(),
	z.object({
		label: z.string(),
		authType: z.string().optional(),
		models: z.array(modelSchema),
	}),
);

export function registerModelsRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/providers/{provider}/models',
			tags: ['config'],
			operationId: 'getProviderModels',
			summary: 'Get available models for a provider',
			request: {
				query: projectQuerySchema,
				params: providerModelsParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: providerModelsResponseSchema },
					},
				},
				'403': {
					description: 'Provider not authorized',
					content: {
						'application/json': { schema: providerModelsErrorSchema },
					},
				},
				'404': {
					description: 'Provider not found',
					content: {
						'application/json': { schema: providerModelsErrorSchema },
					},
				},
			},
		},
		handleGetProviderModels,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/models',
			tags: ['config'],
			operationId: 'getAllModels',
			summary: 'Get all models across authorized providers',
			request: {
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: allModelsResponseSchema },
					},
				},
			},
		},
		handleGetAllModels,
	);
}
