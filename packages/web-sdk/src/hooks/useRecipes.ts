import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ListRecipesScope, RecipeScope } from '../lib/api-client/recipes';

interface UseRecipesOptions {
	enabled?: boolean;
	scope?: ListRecipesScope;
}

export function useRecipes(options: UseRecipesOptions = {}) {
	const enabled = options.enabled ?? true;
	const scope = options.scope ?? 'all';
	return useQuery({
		queryKey: ['recipes', scope],
		queryFn: async () => apiClient.listRecipes(scope),
		enabled,
		refetchInterval: enabled ? 30000 : false,
	});
}

export function useSaveRecipe() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			name,
			content,
			scope = 'project',
		}: {
			name: string;
			content: string;
			scope?: RecipeScope;
		}) => apiClient.saveRecipe(name, content, scope),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['recipes'] });
		},
	});
}

export function useDeleteRecipe() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			name,
			scope = 'project',
		}: {
			name: string;
			scope?: RecipeScope;
		}) => apiClient.deleteRecipe(name, scope),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['recipes'] });
		},
	});
}
