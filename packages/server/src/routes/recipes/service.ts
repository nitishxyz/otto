import type { Context } from 'hono';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '@ottocode/sdk';
import {
	discoverProjectRecipes,
	getProjectRecipesDir,
	isValidRecipeName,
	loadProjectRecipe,
	parseRecipeContent,
} from '../../runtime/commands/recipes.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';

function projectRootFromQuery(c: Context): string {
	return c.req.query('project') || process.cwd();
}

function jsonError(c: Context, message: string, error: unknown) {
	logger.error(message, error);
	const errorResponse = serializeError(error);
	return c.json(errorResponse, (errorResponse.error.status || 500) as 500);
}

function validateRecipeNameRoute(c: Context): string | null {
	const name = c.req.param('name')?.toLowerCase();
	if (!name || !isValidRecipeName(name)) {
		return null;
	}
	return name;
}

function recipeToResponse(
	recipe: Awaited<ReturnType<typeof loadProjectRecipe>>,
) {
	if (!recipe) return null;
	return {
		name: recipe.name,
		agent: recipe.agent,
		description: recipe.description ?? '',
		path: recipe.path,
		content: recipe.content,
	};
}

export async function listRecipes(c: Context) {
	try {
		const projectRoot = projectRootFromQuery(c);
		const recipes = await discoverProjectRecipes(projectRoot);
		return c.json({
			recipes: recipes.map((recipe) => ({
				name: recipe.name,
				agent: recipe.agent,
				description: recipe.description ?? '',
				path: recipe.path,
				content: recipe.content,
			})),
		});
	} catch (error) {
		return jsonError(c, 'Failed to list recipes', error);
	}
}

export async function getRecipe(c: Context) {
	try {
		const name = validateRecipeNameRoute(c);
		if (!name) return c.json({ error: 'Invalid recipe name' }, 400);

		const recipe = await loadProjectRecipe(projectRootFromQuery(c), name);
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

		const body = await c.req.json<{ content?: string }>();
		const content = body.content;
		if (typeof content !== 'string' || !content.trim()) {
			return c.json({ error: 'Recipe content is required' }, 400);
		}

		const parsed = parseRecipeContent(content.replace(/\r\n?/g, '\n'));
		if (!parsed.instructions.trim()) {
			return c.json({ error: 'Recipe instructions are required' }, 400);
		}

		const projectRoot = projectRootFromQuery(c);
		const recipesDir = getProjectRecipesDir(projectRoot);
		await mkdir(recipesDir, { recursive: true });
		const recipePath = join(recipesDir, `${name}.md`);
		await writeFile(recipePath, content, 'utf8');

		const recipe = await loadProjectRecipe(projectRoot, name);
		return c.json({ success: true, recipe: recipeToResponse(recipe) });
	} catch (error) {
		return jsonError(c, 'Failed to save recipe', error);
	}
}

export async function deleteRecipe(c: Context) {
	try {
		const name = validateRecipeNameRoute(c);
		if (!name) return c.json({ error: 'Invalid recipe name' }, 400);

		const recipePath = join(
			getProjectRecipesDir(projectRootFromQuery(c)),
			`${name}.md`,
		);
		await rm(recipePath, { force: true });
		return c.json({ success: true });
	} catch (error) {
		return jsonError(c, 'Failed to delete recipe', error);
	}
}
