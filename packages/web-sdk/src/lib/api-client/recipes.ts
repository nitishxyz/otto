import {
	deleteRecipe as apiDeleteRecipe,
	getRecipe as apiGetRecipe,
	listRecipes as apiListRecipes,
	upsertRecipe as apiUpsertRecipe,
} from '@ottocode/api';
import { extractErrorMessage } from './utils';

export type RecipeScope = 'project' | 'global';

export type RecipeConflict = {
	reason: 'reserved' | 'duplicate';
	scopes?: RecipeScope[];
};

export interface Recipe {
	name: string;
	scope: RecipeScope;
	agent: string;
	includeInHistory: boolean;
	description: string;
	path: string;
	content: string;
	conflict?: RecipeConflict;
}

export type ListRecipesScope = 'all' | RecipeScope;

export const recipesMixin = {
	async listRecipes(
		scope: ListRecipesScope = 'all',
	): Promise<{ recipes: Recipe[] }> {
		const response = await apiListRecipes({
			query: scope === 'all' ? { scope: 'all' } : { scope },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as { recipes: Recipe[] };
	},

	async getRecipe(
		name: string,
		scope: RecipeScope = 'project',
	): Promise<Recipe> {
		const response = await apiGetRecipe({
			path: { name },
			query: { scope },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as Recipe;
	},

	async saveRecipe(
		name: string,
		content: string,
		scope: RecipeScope = 'project',
	): Promise<Recipe | null> {
		const response = await apiUpsertRecipe({
			path: { name },
			query: { scope },
			body: { content },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return (response.data as { recipe: Recipe | null }).recipe;
	},

	async deleteRecipe(
		name: string,
		scope: RecipeScope = 'project',
	): Promise<void> {
		const response = await apiDeleteRecipe({
			path: { name },
			query: { scope },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
	},
};
