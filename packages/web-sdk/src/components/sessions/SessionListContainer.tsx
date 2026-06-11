import { memo, useMemo, useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import {
	useMarkSessionViewed,
	useSessions,
	useSetSessionPinned,
	type SessionListFilter,
} from '../../hooks/useSessions';
import { SessionItem } from './SessionItem';
import { useFocusStore } from '../../stores/focusStore';
import { StableSpinner } from '../ui/StableSpinner';
import { getSessionGroupLabel } from './session-time';
import type { Session } from '../../types/api';

const FOCUS_RING_CLASSES = ['ring-1', 'ring-inset', 'ring-sidebar-ring/40'];

interface SessionListContainerProps {
	activeSessionId?: string;
	onSelectSession: (sessionId: string) => void;
	sessionType?: SessionListFilter;
	emptyMessage?: string;
}

interface SessionSnapshot {
	id: string;
	index: number;
	title: string | null;
	agent: string;
	isRunning: boolean;
	createdAt: number;
	lastActiveAt: number;
	lastViewedAt: number | null;
	pinnedAt: number | null;
	activityAt: number;
}

interface SessionListRowProps {
	session: Session;
	snapshot: SessionSnapshot;
	isActive: boolean;
	onSelectSession: (sessionId: string) => void;
	onTogglePinned: (sessionId: string, isPinned: boolean) => void;
	registerItem: (sessionId: string, element: HTMLDivElement | null) => void;
}

const SessionListRow = memo(function SessionListRow({
	session,
	snapshot,
	isActive,
	onSelectSession,
	onTogglePinned,
	registerItem,
}: SessionListRowProps) {
	const setRef = useCallback(
		(element: HTMLDivElement | null) => {
			registerItem(snapshot.id, element);
		},
		[registerItem, snapshot.id],
	);

	const handleClick = useCallback(() => {
		onSelectSession(snapshot.id);
	}, [onSelectSession, snapshot.id]);

	const handleTogglePinned = useCallback(() => {
		onTogglePinned(snapshot.id, snapshot.pinnedAt == null);
	}, [onTogglePinned, snapshot.id, snapshot.pinnedAt]);

	return (
		<div ref={setRef}>
			<SessionItem
				session={session}
				isActive={isActive}
				onClick={handleClick}
				onTogglePinned={handleTogglePinned}
			/>
		</div>
	);
});

interface SessionFocusControllerProps {
	sessionSnapshot: SessionSnapshot[];
	itemRefs: RefObject<Map<string, HTMLDivElement>>;
}

function SessionFocusController({
	sessionSnapshot,
	itemRefs,
}: SessionFocusControllerProps) {
	const currentFocus = useFocusStore((state) => state.currentFocus);
	const sessionIndex = useFocusStore((state) => state.sessionIndex);
	const previousFocusedSessionId = useRef<string | null>(null);

	useEffect(() => {
		const previousId = previousFocusedSessionId.current;
		if (previousId) {
			const previousElement = itemRefs.current?.get(previousId);
			previousElement?.classList.remove(...FOCUS_RING_CLASSES);
		}

		if (currentFocus !== 'sessions') {
			previousFocusedSessionId.current = null;
			return;
		}

		const session = sessionSnapshot[sessionIndex];
		if (!session) {
			previousFocusedSessionId.current = null;
			return;
		}

		const element = itemRefs.current?.get(session.id);
		element?.classList.add(...FOCUS_RING_CLASSES);
		element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		previousFocusedSessionId.current = session.id;
	}, [currentFocus, itemRefs, sessionIndex, sessionSnapshot]);

	return null;
}

export const SessionListContainer = memo(function SessionListContainer({
	activeSessionId,
	onSelectSession,
	sessionType,
	emptyMessage,
}: SessionListContainerProps) {
	const {
		data: sessions = [],
		isLoading,
		hasNextPage,
		fetchNextPage,
		isFetchingNextPage,
	} = useSessions(sessionType);
	const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const paginationSentinelRef = useRef<HTMLDivElement>(null);
	const lastScrolledSessionId = useRef<string | undefined>(undefined);
	const markedViewedRef = useRef<Map<string, number>>(new Map());
	const previousActiveSessionId = useRef<string | undefined>(activeSessionId);
	const runningOrderRef = useRef<string[]>([]);
	const markSessionViewed = useMarkSessionViewed();
	const setSessionPinned = useSetSessionPinned();

	const handleSessionClick = useCallback(
		(sessionId: string) => {
			lastScrolledSessionId.current = sessionId;
			onSelectSession(sessionId);
		},
		[onSelectSession],
	);

	const registerItem = useCallback(
		(sessionId: string, element: HTMLDivElement | null) => {
			if (element) itemRefs.current.set(sessionId, element);
			else itemRefs.current.delete(sessionId);
		},
		[],
	);

	const handleTogglePinned = useCallback(
		(sessionId: string, isPinned: boolean) => {
			setSessionPinned.mutate({ sessionId, isPinned });
		},
		[setSessionPinned],
	);

	const sessionSnapshot = useMemo<SessionSnapshot[]>(() => {
		return sessions.map((s, index) => ({
			id: s.id,
			index,
			title: s.title,
			agent: s.agent,
			isRunning: s.isRunning ?? false,
			createdAt: s.createdAt,
			lastActiveAt: s.lastActiveAt,
			lastViewedAt: s.lastViewedAt ?? null,
			pinnedAt: s.pinnedAt ?? null,
			activityAt: s.lastActiveAt ?? s.createdAt,
		}));
	}, [sessions]);

	const sessionMap = useMemo(
		() => new Map(sessions.map((session) => [session.id, session])),
		[sessions],
	);
	const sessionSnapshotMap = useMemo(
		() => new Map(sessionSnapshot.map((session) => [session.id, session])),
		[sessionSnapshot],
	);

	const runningSessions = useMemo(() => {
		const runningSessionMap = new Map(
			sessionSnapshot
				.filter((session) => session.isRunning && session.pinnedAt == null)
				.map((session) => [session.id, session]),
		);

		runningOrderRef.current = runningOrderRef.current.filter((id) =>
			runningSessionMap.has(id),
		);

		for (const session of sessionSnapshot) {
			if (
				session.isRunning &&
				session.pinnedAt == null &&
				!runningOrderRef.current.includes(session.id)
			) {
				runningOrderRef.current.push(session.id);
			}
		}

		return runningOrderRef.current
			.map((id) => runningSessionMap.get(id))
			.filter((session) => Boolean(session));
	}, [sessionSnapshot]);

	const runningSessionIds = useMemo(
		() => new Set(runningSessions.map((session) => session.id)),
		[runningSessions],
	);

	const pinnedGroups = useMemo(() => {
		const pinnedSessions = sessionSnapshot.filter(
			(session) => session.pinnedAt != null,
		);
		return pinnedSessions.length > 0
			? [{ label: 'Pinned', sessions: pinnedSessions }]
			: [];
	}, [sessionSnapshot]);

	const statusGroups = useMemo(
		() => [
			...(runningSessions.length > 0
				? [
						{
							label: 'Running',
							sessions: runningSessions,
						},
					]
				: []),
		],
		[runningSessions],
	);

	const recentGroups = useMemo(() => {
		const groups = new Map<string, typeof sessionSnapshot>();

		for (const session of sessionSnapshot) {
			if (session.pinnedAt != null) continue;
			if (runningSessionIds.has(session.id)) continue;
			const label = getSessionGroupLabel(session.activityAt);
			const existingSessions = groups.get(label) ?? [];
			existingSessions.push(session);
			groups.set(label, existingSessions);
		}

		return Array.from(groups.entries()).map(([label, groupedSessions]) => ({
			label,
			sessions: groupedSessions,
		}));
	}, [sessionSnapshot, runningSessionIds]);

	const markViewedIfReady = useCallback(
		(sessionId: string) => {
			const session = sessionSnapshotMap.get(sessionId);
			if (!session || session.isRunning) return;
			if (session.activityAt <= (session.lastViewedAt ?? 0)) return;
			if (markedViewedRef.current.get(session.id) === session.activityAt) {
				return;
			}

			markedViewedRef.current.set(session.id, session.activityAt);
			markSessionViewed.mutate(session.id, {
				onError: () => markedViewedRef.current.delete(session.id),
			});
		},
		[markSessionViewed, sessionSnapshotMap],
	);

	useEffect(() => {
		const previousId = previousActiveSessionId.current;
		if (previousId && previousId !== activeSessionId) {
			markViewedIfReady(previousId);
		}
		previousActiveSessionId.current = activeSessionId;
	}, [activeSessionId, markViewedIfReady]);

	useEffect(() => {
		if (
			!activeSessionId ||
			lastScrolledSessionId.current === activeSessionId ||
			sessionSnapshot.length === 0
		)
			return;

		const activeSession = sessionSnapshotMap.get(activeSessionId);
		if (!activeSession && hasNextPage) {
			fetchNextPage();
			return;
		}

		if (activeSession) {
			lastScrolledSessionId.current = activeSessionId;
			requestAnimationFrame(() => {
				const element = itemRefs.current.get(activeSessionId);
				element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			});
		}
	}, [
		activeSessionId,
		sessionSnapshot.length,
		sessionSnapshotMap,
		hasNextPage,
		fetchNextPage,
	]);

	useEffect(() => {
		const container = scrollContainerRef.current;
		if (!container) return;
		const loadMore = () => {
			if (hasNextPage && !isFetchingNextPage) {
				fetchNextPage();
			}
		};

		const handleScroll = () => {
			const { scrollTop, scrollHeight, clientHeight } = container;
			if (scrollHeight - scrollTop - clientHeight < 160) {
				loadMore();
			}
		};

		if (container.scrollHeight <= container.clientHeight + 160) {
			loadMore();
		}

		container.addEventListener('scroll', handleScroll, { passive: true });
		return () => container.removeEventListener('scroll', handleScroll);
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	useEffect(() => {
		const container = scrollContainerRef.current;
		const sentinel = paginationSentinelRef.current;
		if (
			!container ||
			!sentinel ||
			typeof IntersectionObserver === 'undefined'
		) {
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					if (hasNextPage && !isFetchingNextPage) {
						fetchNextPage();
					}
				}
			},
			{ root: container, rootMargin: '160px 0px' },
		);

		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	if (isLoading) {
		return (
			<div className="flex flex-col gap-2 px-3 py-2">
				<div className="h-8 rounded-md bg-sidebar-accent/50 animate-pulse" />
				<div className="h-8 rounded-md bg-sidebar-accent/50 animate-pulse" />
				<div className="h-8 rounded-md bg-sidebar-accent/50 animate-pulse" />
				<div className="h-8 rounded-md bg-sidebar-accent/50 animate-pulse" />
			</div>
		);
	}

	if (sessionSnapshot.length === 0) {
		return (
			<div className="px-4 py-8 text-center text-sm text-sidebar-muted-foreground">
				{emptyMessage ?? 'No sessions yet. Create one to get started.'}
			</div>
		);
	}

	const renderSession = (session: SessionSnapshot) => {
		const fullSession = sessionMap.get(session.id);
		if (!fullSession) return null;

		return (
			<SessionListRow
				key={session.id}
				session={fullSession}
				snapshot={session}
				isActive={session.id === activeSessionId}
				onSelectSession={handleSessionClick}
				onTogglePinned={handleTogglePinned}
				registerItem={registerItem}
			/>
		);
	};

	const renderGroup = (group: {
		label: string;
		sessions: SessionSnapshot[];
	}) => (
		<div key={group.label}>
			<h4 className="sticky top-12 z-10 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-muted-foreground/80 bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/75 border-b border-sidebar-border/60">
				<span>{group.label}</span>
				<span className="ml-2 text-sidebar-muted-foreground/60">
					{group.sessions.length}
				</span>
			</h4>
			<div className="flex flex-col">
				{group.sessions.map((session) => renderSession(session))}
			</div>
		</div>
	);

	return (
		<div
			ref={scrollContainerRef}
			className="flex flex-col h-full overflow-y-auto scrollbar-hide"
		>
			<SessionFocusController
				sessionSnapshot={sessionSnapshot}
				itemRefs={itemRefs}
			/>
			<div className="h-12 shrink-0" aria-hidden="true" />
			<div className="pt-3 pb-1">
				<div className="space-y-4">
					{pinnedGroups.map((group) => renderGroup(group))}
					{statusGroups.map((group) => renderGroup(group))}
					{recentGroups.map((group) => renderGroup(group))}
				</div>
			</div>

			{isFetchingNextPage && (
				<div className="flex justify-center py-3">
					<StableSpinner
						className="text-sidebar-muted-foreground"
						title="Loading more sessions"
					/>
				</div>
			)}
			<div
				ref={paginationSentinelRef}
				className="h-1 shrink-0"
				aria-hidden="true"
			/>
		</div>
	);
});
