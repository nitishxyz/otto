import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	deleteRecipe,
	getRecipe,
	listRecipes,
	upsertRecipe,
} from './recipes/service.ts';

const recipeScopeSchema = z.enum(['project', 'global']);

const recipeConflictSchema = z.object({
	reason: z.enum(['reserved', 'duplicate']),
	scopes: z.array(recipeScopeSchema).optional(),
});

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

const listRecipesQuerySchema = projectQuerySchema.extend({
	scope: z
		.enum(['all', 'project', 'global'])
		.optional()
		.openapi({
			param: { name: 'scope', in: 'query' },
			description:
				'Recipe scope filter. Defaults to all for listing project and global recipes.',
		}),
});

const recipeScopeQuerySchema = projectQuerySchema.extend({
	scope: recipeScopeSchema.optional().openapi({
		param: { name: 'scope', in: 'query' },
		description: 'Recipe scope. Defaults to project.',
	}),
});

const recipeNameParamsSchema = z.object({
	name: z.string().openapi({ param: { name: 'name', in: 'path' } }),
});

const recipeSchema = z.object({
	name: z.string(),
	scope: recipeScopeSchema,
	agent: z.string(),
	includeInHistory: z.boolean(),
	description: z.string(),
	path: z.string(),
	content: z.string(),
	conflict: recipeConflictSchema.optional(),
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
			summary: 'List recipes',
			request: { query: listRecipesQuerySchema },
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
			summary: 'Get a recipe',
			request: {
				params: recipeNameParamsSchema,
				query: recipeScopeQuerySchema,
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
			summary: 'Create or update a recipe',
			request: {
				params: recipeNameParamsSchema,
				query: recipeScopeQuerySchema,
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
				'409': {
					description: 'Reserved or duplicate recipe name',
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
			summary: 'Delete a recipe',
			request: {
				params: recipeNameParamsSchema,
				query: recipeScopeQuerySchema,
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
