import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

interface UseRecipesOptions {
	enabled?: boolean;
}

export function useRecipes(options: UseRecipesOptions = {}) {
	const enabled = options.enabled ?? true;
	return useQuery({
		queryKey: ['recipes'],
		queryFn: async () => apiClient.listRecipes(),
		enabled,
		refetchInterval: enabled ? 30000 : false,
	});
}

export function useSaveRecipe() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ name, content }: { name: string; content: string }) =>
			apiClient.saveRecipe(name, content),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['recipes'] });
		},
	});
}

export function useDeleteRecipe() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => apiClient.deleteRecipe(name),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['recipes'] });
		},
	});
}
