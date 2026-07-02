import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiClient } from '../lib/api-client';
import { projectScopedKey } from '../lib/api-client/utils';
import type {
	CreateSessionRequest,
	UpdateSessionRequest,
	Session,
	SessionsPage,
} from '../types/api';

const SESSIONS_PAGE_SIZE = 50;

export const sessionsQueryKey = ['sessions', 'list'] as const;

export function getSessionsQueryKey(sessionType?: SessionListFilter) {
	return sessionType
		? projectScopedKey([...sessionsQueryKey, sessionType] as const)
		: projectScopedKey(sessionsQueryKey);
}

export function getSessionQueryKey(sessionId: string) {
	return projectScopedKey(['session', sessionId] as const);
}

export type SessionListFilter = 'looper' | undefined;

export function useSessionsInfinite(sessionType?: SessionListFilter) {
	return useInfiniteQuery({
		queryKey: getSessionsQueryKey(sessionType),
		queryFn: ({ pageParam = 0 }) =>
			apiClient.getSessionsPage({
				limit: SESSIONS_PAGE_SIZE,
				offset: pageParam,
				sessionType,
			}),
		getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
		initialPageParam: 0,
		staleTime: 30_000,
		refetchInterval: 30_000,
		refetchOnWindowFocus: false,
	});
}

export function useSessions(sessionType?: SessionListFilter) {
	const query = useSessionsInfinite(sessionType);
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

/**
 * Resolves a session row by id. Looks in the main sessions list first; when
 * the session is not listed there (e.g. otto orchestrator sessions, which are
 * excluded from the default listing) it falls back to fetching the single
 * session. The fallback query stays disabled for normally-listed sessions.
 */
export function useSession(sessionId: string) {
	const { data: sessions } = useSessions();
	const listed = sessions?.find((s) => s.id === sessionId);
	const { data: detail } = useQuery({
		queryKey: getSessionQueryKey(sessionId),
		queryFn: () => apiClient.getSession(sessionId),
		enabled: Boolean(sessionId) && !listed,
		staleTime: 15_000,
	});
	return listed ?? detail;
}

export function useCreateSession() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: CreateSessionRequest) => apiClient.createSession(data),
		onSuccess: (newSession) => {
			const queryKey = getSessionsQueryKey();
			queryClient.setQueryData<{ pages: SessionsPage[]; pageParams: number[] }>(
				queryKey,
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
			queryClient.invalidateQueries({ queryKey });
		},
	});
}

export function useUpdateSession(sessionId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: UpdateSessionRequest) =>
			apiClient.updateSession(sessionId, data),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: getSessionsQueryKey() });
			await queryClient.invalidateQueries({
				queryKey: getSessionQueryKey(sessionId),
			});
		},
	});
}

export function useSetSessionPinned() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			sessionId,
			isPinned,
		}: {
			sessionId: string;
			isPinned: boolean;
		}) => apiClient.updateSession(sessionId, { isPinned }),
		onSuccess: async (updatedSession) => {
			const queryKey = getSessionsQueryKey();
			queryClient.setQueryData<{ pages: SessionsPage[]; pageParams: number[] }>(
				queryKey,
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
			await queryClient.invalidateQueries({ queryKey });
			await queryClient.invalidateQueries({
				queryKey: getSessionQueryKey(updatedSession.id),
			});
		},
	});
}

export function useMarkSessionViewed() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (sessionId: string) => apiClient.markSessionViewed(sessionId),
		onSuccess: (updatedSession) => {
			const queryKey = getSessionsQueryKey();
			queryClient.setQueryData<{ pages: SessionsPage[]; pageParams: number[] }>(
				queryKey,
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
			queryClient.invalidateQueries({ queryKey: getSessionsQueryKey() });
		},
	});
}
