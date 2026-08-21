import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
	listSessions,
	createSession as apiCreateSession,
	deleteSession as apiDeleteSession,
	createMessage,
	abortSession as apiAbortSession,
	resolveApproval,
	updateSession as apiUpdateSession,
	getSession as apiGetSession,
} from '@ottocode/api';
import type { Session } from '../types.ts';
import { getProjectKey, getProjectQuery } from '../api.ts';

const PAGE_SIZE = 50;

type SessionCreateDefaults = {
	agent?: string;
	provider?: string;
	model?: string;
	allowUnknownModel?: boolean;
};

interface SessionError {
	id: number;
	sessionId: string | null;
	message: string;
}

function getApiErrorMessage(error: unknown, fallback: string): string {
	if (typeof error === 'string') return error;
	if (!error || typeof error !== 'object') return fallback;
	const payload = error as { error?: unknown; message?: unknown };
	if (typeof payload.message === 'string') return payload.message;
	if (typeof payload.error === 'string') return payload.error;
	if (payload.error && typeof payload.error === 'object') {
		const nested = payload.error as { message?: unknown };
		if (typeof nested.message === 'string') return nested.message;
	}
	return fallback;
}

function sortSessions(list: Session[]): Session[] {
	return [...list].sort((a, b) => {
		const aTime = a.lastActiveAt ?? a.createdAt ?? 0;
		const bTime = b.lastActiveAt ?? b.createdAt ?? 0;
		return bTime - aTime;
	});
}

export function useSession(defaultCreateSession?: SessionCreateDefaults) {
	const [sessions, setSessions] = useState<Session[]>([]);
	const [activeSession, setActiveSession] = useState<Session | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [sessionError, setSessionError] = useState<SessionError | null>(null);
	const sessionErrorIdRef = useRef(0);
	const nextOffsetRef = useRef<number | null>(null);
	const projectKey = getProjectKey();
	const projectQuery = useMemo(() => {
		void projectKey;
		return getProjectQuery();
	}, [projectKey]);

	const loadSessions = useCallback(async () => {
		try {
			const response = await listSessions({
				query: { ...projectQuery, limit: PAGE_SIZE, offset: 0 },
			});
			const data = response.data;
			const sorted = sortSessions((data?.items ?? []) as Session[]);
			setSessions(sorted);
			setHasMore(data?.hasMore ?? false);
			nextOffsetRef.current = data?.nextOffset ?? null;
			return sorted;
		} catch {
			return [];
		}
	}, [projectQuery]);

	const loadMoreSessions = useCallback(async () => {
		if (loadingMore || !hasMore || nextOffsetRef.current === null) return;
		setLoadingMore(true);
		try {
			const response = await listSessions({
				query: {
					...projectQuery,
					limit: PAGE_SIZE,
					offset: nextOffsetRef.current,
				},
			});
			const data = response.data;
			const newItems = (data?.items ?? []) as Session[];
			setSessions((prev) => {
				const existingIds = new Set(prev.map((s) => s.id));
				const unique = newItems.filter((s) => !existingIds.has(s.id));
				return sortSessions([...prev, ...unique]);
			});
			setHasMore(data?.hasMore ?? false);
			nextOffsetRef.current = data?.nextOffset ?? null;
		} catch {
		} finally {
			setLoadingMore(false);
		}
	}, [loadingMore, hasMore, projectQuery]);

	const createSession = useCallback(
		async (title?: string): Promise<Session | null> => {
			try {
				setSessionError(null);
				const response = await apiCreateSession({
					query: projectQuery,
					body: { ...defaultCreateSession, title },
				} as never);
				if (response.error) {
					throw new Error(
						getApiErrorMessage(response.error, 'failed to create session'),
					);
				}
				const session = response.data as Session;
				if (!session) return null;
				setSessions((prev) => sortSessions([session, ...prev]));
				setActiveSession(session);
				return session;
			} catch (error) {
				setSessionError({
					id: ++sessionErrorIdRef.current,
					sessionId: null,
					message: getApiErrorMessage(error, 'failed to create session'),
				});
				return null;
			}
		},
		[defaultCreateSession, projectQuery],
	);

	const deleteSessionFn = useCallback(
		async (id: string) => {
			try {
				await apiDeleteSession({
					path: { sessionId: id },
					query: projectQuery,
				} as never);
				setSessions((prev) => prev.filter((s) => s.id !== id));
				if (activeSession?.id === id) {
					setActiveSession(null);
				}
			} catch {}
		},
		[activeSession, projectQuery],
	);

	const switchSession = useCallback((session: Session) => {
		setActiveSession(session);
	}, []);

	const updateSessionMeta = useCallback((payload: Record<string, unknown>) => {
		const id = typeof payload.id === 'string' ? payload.id : null;
		if (!id) return;
		const title = typeof payload.title === 'string' ? payload.title : undefined;
		if (title !== undefined) {
			setActiveSession((prev) => (prev?.id === id ? { ...prev, title } : prev));
			setSessions((prev) =>
				prev.map((s) => (s.id === id ? { ...s, title } : s)),
			);
		}
	}, []);

	const updateSessionPrefs = useCallback(
		async (
			sessionId: string,
			changes: {
				agent?: string;
				provider?: string;
				model?: string;
				allowUnknownModel?: boolean;
			},
		) => {
			try {
				await apiUpdateSession({
					path: { sessionId },
					query: projectQuery,
					body: changes,
				} as never);
				setActiveSession((prev) => {
					if (prev?.id !== sessionId) return prev;
					return { ...prev, ...changes };
				});
				setSessions((prev) =>
					prev.map((s) => (s.id === sessionId ? { ...s, ...changes } : s)),
				);
			} catch {}
		},
		[projectQuery],
	);

	const sendMessage = useCallback(
		async (
			sessionId: string,
			content: string,
			images?: unknown[],
			files?: unknown[],
		): Promise<string | null> => {
			try {
				setSessionError(null);
				const response = await createMessage({
					path: { id: sessionId },
					query: projectQuery,
					body: {
						content,
						...(defaultCreateSession?.allowUnknownModel
							? { allowUnknownModel: true }
							: {}),
						...(images ? { images } : {}),
						...(files ? { files } : {}),
						// biome-ignore lint/suspicious/noExplicitAny: Server accepts images/files but SDK types don't include them
					} as any,
				});
				if (response.error) {
					throw new Error(
						getApiErrorMessage(response.error, 'failed to send message'),
					);
				}
				return typeof response.data?.messageId === 'string'
					? response.data.messageId
					: null;
			} catch (error) {
				setSessionError({
					id: ++sessionErrorIdRef.current,
					sessionId,
					message: getApiErrorMessage(error, 'failed to send message'),
				});
				return null;
			}
		},
		[defaultCreateSession?.allowUnknownModel, projectQuery],
	);

	const abortSessionFn = useCallback(
		async (sessionId: string) => {
			try {
				await apiAbortSession({
					path: { sessionId },
					query: projectQuery,
					body: {},
				} as never);
			} catch {}
		},
		[projectQuery],
	);

	const approveToolCall = useCallback(
		async (sessionId: string, callId: string, approved: boolean) => {
			try {
				await resolveApproval({
					path: { id: sessionId },
					query: projectQuery,
					body: { callId, approved },
				} as never);
			} catch {}
		},
		[projectQuery],
	);

	const refreshActiveSession = useCallback(
		async (sessionId: string) => {
			try {
				const response = await apiGetSession({
					path: { sessionId },
					query: projectQuery,
				} as never);
				const session = response.data as Session | undefined;
				if (!session) return;
				setActiveSession((prev) =>
					prev?.id === sessionId ? { ...prev, ...session } : prev,
				);
				setSessions((prev) =>
					prev.map((s) => (s.id === sessionId ? { ...s, ...session } : s)),
				);
			} catch {}
		},
		[projectQuery],
	);

	useEffect(() => {
		loadSessions();
	}, [loadSessions]);

	return {
		sessions,
		activeSession,
		hasMore,
		loadingMore,
		sessionError,
		loadSessions,
		loadMoreSessions,
		createSession,
		deleteSession: deleteSessionFn,
		switchSession,
		updateSessionMeta,
		updateSessionPrefs,
		refreshActiveSession,
		sendMessage,
		abortSession: abortSessionFn,
		approveToolCall,
	};
}
