import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiClient } from '../lib/api-client';
import type {
	CreateSessionRequest,
	UpdateSessionRequest,
	Session,
	SessionsPage,
} from '../types/api';

const SESSIONS_PAGE_SIZE = 50;

export const sessionsQueryKey = ['sessions', 'list'] as const;

export function useSessionsInfinite() {
	return useInfiniteQuery({
		queryKey: sessionsQueryKey,
		queryFn: ({ pageParam = 0 }) =>
			apiClient.getSessionsPage({
				limit: SESSIONS_PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
		initialPageParam: 0,
		staleTime: 30_000,
		refetchInterval: 30_000,
		refetchOnWindowFocus: false,
	});
}

export function useSessions() {
	const query = useSessionsInfinite();
	const data = useMemo<Session[]>(() => {
		if (!query.data?.pages) return [];
		return query.data.pages.flatMap((p) => p.items ?? []);
	}, [query.data]);

	return {
		data,
		isLoading: query.isLoading,
		isError: query.isError,
		error: query.error,
		hasNextPage: query.hasNextPage,
		fetchNextPage: query.fetchNextPage,
		isFetchingNextPage: query.isFetchingNextPage,
	};
}

export function useSession(sessionId: string) {
	const { data: sessions } = useSessions();
	return sessions?.find((s) => s.id === sessionId);
}

export function useCreateSession() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: CreateSessionRequest) => apiClient.createSession(data),
		onSuccess: (newSession) => {
			queryClient.setQueryData<{ pages: SessionsPage[]; pageParams: number[] }>(
				sessionsQueryKey,
				(old) => {
					if (!old) return old;
					const firstPage = old.pages[0];
					if (!firstPage) return old;
					return {
						...old,
						pages: [
							{ ...firstPage, items: [newSession, ...firstPage.items] },
							...old.pages.slice(1),
						],
					};
				},
			);
			queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
		},
	});
}

export function useUpdateSession(sessionId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: UpdateSessionRequest) =>
			apiClient.updateSession(sessionId, data),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
			await queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
		},
	});
}

export function useMarkSessionViewed() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (sessionId: string) => apiClient.markSessionViewed(sessionId),
		onSuccess: (updatedSession) => {
			queryClient.setQueryData<{ pages: SessionsPage[]; pageParams: number[] }>(
				sessionsQueryKey,
				(old) => {
					if (!old) return old;
					return {
						...old,
						pages: old.pages.map((page) => ({
							...page,
							items: page.items.map((session) =>
								session.id === updatedSession.id
									? { ...session, ...updatedSession }
									: session,
							),
						})),
					};
				},
			);
		},
	});
}

export function useDeleteSession() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (sessionId: string) => apiClient.deleteSession(sessionId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
		},
	});
}
