import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
	ListReferenceScope,
	Reference,
	ReferenceScope,
} from '../lib/api-client/references';

export function useReferences(
	scope: ListReferenceScope,
	options: { enabled?: boolean } = {},
) {
	return useQuery({
		queryKey: ['references', scope],
		queryFn: () => apiClient.listReferences(scope),
		enabled: options.enabled ?? true,
	});
}

export function useSaveReference() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			name: string;
			reference: Reference;
			scope: ReferenceScope;
		}) => apiClient.saveReference(input.name, input.reference, input.scope),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['references'] });
		},
	});
}

export function useDeleteReference() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { name: string; scope: ReferenceScope }) =>
			apiClient.deleteReference(input.name, input.scope),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['references'] });
		},
	});
}
