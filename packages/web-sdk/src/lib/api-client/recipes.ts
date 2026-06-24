import {
	deleteRecipe as apiDeleteRecipe,
	listRecipes as apiListRecipes,
	upsertRecipe as apiUpsertRecipe,
} from '@ottocode/api';
import { extractErrorMessage } from './utils';

export interface Recipe {
	name: string;
	agent: string;
	includeInHistory: boolean;
	description: string;
	path: string;
	content: string;
}

export const recipesMixin = {
	async listRecipes(): Promise<{ recipes: Recipe[] }> {
		const response = await apiListRecipes();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as { recipes: Recipe[] };
	},

	async saveRecipe(name: string, content: string): Promise<Recipe | null> {
		const response = await apiUpsertRecipe({
			path: { name },
			body: { content },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return (response.data as { recipe: Recipe | null }).recipe;
	},

	async deleteRecipe(name: string): Promise<void> {
		const response = await apiDeleteRecipe({ path: { name } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
	},
};
