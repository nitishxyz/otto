import type { Context } from 'hono';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '@ottocode/sdk';
import {
	discoverAllRecipes,
	getRecipesDir,
	isValidRecipeName,
	loadRecipe,
	parseRecipeContent,
	type Recipe,
	type RecipeScope,
	validateRecipeNameForScope,
} from '../../runtime/commands/recipes.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

type ListRecipesScope = 'all' | RecipeScope;

async function projectRootFromQuery(c: Context): Promise<string> {
	return resolveRequestProjectRoot(c);
}

function listScopeFromQuery(c: Context): ListRecipesScope {
	const { scope } = c.req.valid('query' as never) as { scope?: string };
	if (scope === 'project' || scope === 'global') return scope;
	return 'all';
}

function recipeScopeFromQuery(c: Context): RecipeScope {
	const { scope } = c.req.valid('query' as never) as { scope?: string };
	return scope === 'global' ? 'global' : 'project';
}

function jsonError(c: Context, message: string, error: unknown) {
	logger.error(message, error);
	const errorResponse = serializeError(error);
	const status = (errorResponse.error.status || 500) as 400 | 409 | 500;
	return c.json(errorResponse, status);
}

function validateRecipeNameRoute(c: Context): string | null {
	const name = (
		c.req.valid('param' as never) as { name: string }
	).name.toLowerCase();
	if (!name || !isValidRecipeName(name)) {
		return null;
	}
	return name;
}

function recipeToResponse(recipe: Recipe | null) {
	if (!recipe) return null;
	return {
		name: recipe.name,
		scope: recipe.scope,
		agent: recipe.agent,
		includeInHistory: recipe.includeInHistory,
		description: recipe.description ?? '',
		path: recipe.path,
		content: recipe.content,
		...(recipe.conflict ? { conflict: recipe.conflict } : {}),
	};
}

async function listRecipesForScope(
	projectRoot: string,
	scope: ListRecipesScope,
): Promise<Recipe[]> {
	const recipes = await discoverAllRecipes(projectRoot);
	if (scope === 'all') return recipes;
	return recipes.filter((recipe) => recipe.scope === scope);
}

export async function listRecipes(c: Context) {
	try {
		const projectRoot = await projectRootFromQuery(c);
		const scope = listScopeFromQuery(c);
		const recipes = await listRecipesForScope(projectRoot, scope);
		return c.json({
			recipes: recipes.flatMap((recipe) => {
				const response = recipeToResponse(recipe);
				return response ? [response] : [];
			}),
		});
	} catch (error) {
		return jsonError(c, 'Failed to list recipes', error);
	}
}

export async function getRecipe(c: Context) {
	try {
		const name = validateRecipeNameRoute(c);
		if (!name) return c.json({ error: 'Invalid recipe name' }, 400);

		const projectRoot = await projectRootFromQuery(c);
		const scope = recipeScopeFromQuery(c);
		const recipes = await discoverAllRecipes(projectRoot);
		const recipe = recipes.find(
			(item) => item.name === name && item.scope === scope,
		);
		if (!recipe) return c.json({ error: 'Recipe not found' }, 404);
		return c.json(recipeToResponse(recipe));
	} catch (error) {
		return jsonError(c, 'Failed to get recipe', error);
	}
}

export async function upsertRecipe(c: Context) {
	try {
		const name = validateRecipeNameRoute(c);
		if (!name) return c.json({ error: 'Invalid recipe name' }, 400);

		const body = c.req.valid('json' as never) as { content?: string };
		const content = body.content;
		if (typeof content !== 'string' || !content.trim()) {
			return c.json({ error: 'Recipe content is required' }, 400);
		}

		const parsed = parseRecipeContent(content.replace(/\r\n?/g, '\n'));
		if (!parsed.instructions.trim()) {
			return c.json({ error: 'Recipe instructions are required' }, 400);
		}

		const projectRoot = await projectRootFromQuery(c);
		const scope = recipeScopeFromQuery(c);
		const validation = await validateRecipeNameForScope({
			projectRoot,
			scope,
			name,
		});
		if (!validation.ok) {
			return c.json({ error: validation.message }, validation.status);
		}

		const recipesDir = getRecipesDir(scope, projectRoot);
		await mkdir(recipesDir, { recursive: true });
		const recipePath = join(recipesDir, `${name}.md`);
		await writeFile(recipePath, content, 'utf8');

		const recipe = await loadRecipe({ projectRoot, scope, name });
		return c.json({ success: true, recipe: recipeToResponse(recipe) });
	} catch (error) {
		return jsonError(c, 'Failed to save recipe', error);
	}
}

export async function deleteRecipe(c: Context) {
	try {
		const name = validateRecipeNameRoute(c);
		if (!name) return c.json({ error: 'Invalid recipe name' }, 400);

		const projectRoot = await projectRootFromQuery(c);
		const scope = recipeScopeFromQuery(c);
		const recipePath = join(getRecipesDir(scope, projectRoot), `${name}.md`);
		await rm(recipePath, { force: true });
		return c.json({ success: true });
	} catch (error) {
		return jsonError(c, 'Failed to delete recipe', error);
	}
}
