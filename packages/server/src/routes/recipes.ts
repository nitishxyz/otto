import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	deleteRecipe,
	getRecipe,
	listRecipes,
	upsertRecipe,
} from './recipes/service.ts';

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

const recipeNameParamsSchema = z.object({
	name: z.string().openapi({ param: { name: 'name', in: 'path' } }),
});

const recipeSchema = z.object({
	name: z.string(),
	agent: z.string(),
	description: z.string(),
	path: z.string(),
	content: z.string(),
});

const recipeBodySchema = z.object({
	content: z.string(),
});

const errorResponseSchema = z.object({ error: z.string() });

export function registerRecipesRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/recipes',
			tags: ['config'],
			operationId: 'listRecipes',
			summary: 'List project recipes',
			request: { query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: z.object({ recipes: z.array(recipeSchema) }),
						},
					},
				},
				'500': {
					description: 'Server error',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		listRecipes,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/recipes/{name}',
			tags: ['config'],
			operationId: 'getRecipe',
			summary: 'Get a project recipe',
			request: {
				params: recipeNameParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: recipeSchema } },
				},
				'400': {
					description: 'Invalid name',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
				'404': {
					description: 'Not found',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
				'500': {
					description: 'Server error',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		getRecipe,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'put',
			path: '/v1/recipes/{name}',
			tags: ['config'],
			operationId: 'upsertRecipe',
			summary: 'Create or update a project recipe',
			request: {
				params: recipeNameParamsSchema,
				query: projectQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: recipeBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: z.object({
								success: z.boolean(),
								recipe: recipeSchema.nullable(),
							}),
						},
					},
				},
				'400': {
					description: 'Invalid request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
				'500': {
					description: 'Server error',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		upsertRecipe,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/recipes/{name}',
			tags: ['config'],
			operationId: 'deleteRecipe',
			summary: 'Delete a project recipe',
			request: {
				params: recipeNameParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: z.object({ success: z.boolean() }),
						},
					},
				},
				'400': {
					description: 'Invalid name',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
				'500': {
					description: 'Server error',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		deleteRecipe,
	);
}
