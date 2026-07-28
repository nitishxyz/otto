import { useEffect, useState } from 'react';
import { listRecipes } from '@ottocode/api';
import { recipeSlashCommands, type SlashCommand } from '../commands/index.ts';
import { getProjectQuery } from '../api.ts';

const RECIPE_REFRESH_INTERVAL_MS = 30_000;

/** Loads invokable recipe commands shared by TUI input and message rendering. */
export function useRecipeCommands(): SlashCommand[] {
	const [commands, setCommands] = useState<SlashCommand[]>([]);

	useEffect(() => {
		let cancelled = false;
		const loadRecipes = async () => {
			try {
				const response = await listRecipes({ query: getProjectQuery() });
				if (cancelled || !response.data) return;
				setCommands(recipeSlashCommands(response.data.recipes));
			} catch {
				// Keep built-in suggestions available if recipe discovery fails.
			}
		};

		void loadRecipes();
		const interval = setInterval(
			() => void loadRecipes(),
			RECIPE_REFRESH_INTERVAL_MS,
		);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, []);

	return commands;
}
