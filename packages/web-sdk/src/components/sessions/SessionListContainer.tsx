import { memo, useMemo, useCallback, useEffect, useRef } from 'react';
import { useMarkSessionViewed, useSessions } from '../../hooks/useSessions';
import { SessionItem } from './SessionItem';
import { useFocusStore } from '../../stores/focusStore';
import { Loader2 } from 'lucide-react';
import { getSessionGroupLabel } from './session-time';

interface SessionListContainerProps {
	activeSessionId?: string;
	onSelectSession: (sessionId: string) => void;
}

export const SessionListContainer = memo(function SessionListContainer({
	activeSessionId,
	onSelectSession,
}: SessionListContainerProps) {
	const {
		data: sessions = [],
		isLoading,
		hasNextPage,
		fetchNextPage,
		isFetchingNextPage,
	} = useSessions();
	const { currentFocus, sessionIndex } = useFocusStore();
	const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const paginationSentinelRef = useRef<HTMLDivElement>(null);
	const lastScrolledSessionId = useRef<string | undefined>(undefined);
	const markedViewedRef = useRef<Map<string, number>>(new Map());
	const previousActiveSessionId = useRef<string | undefined>(activeSessionId);
	const markSessionViewed = useMarkSessionViewed();

	const handleSessionClick = useCallback(
		(sessionId: string) => {
			lastScrolledSessionId.current = sessionId;
			onSelectSession(sessionId);
		},
		[onSelectSession],
	);

	const sessionSnapshot = useMemo(() => {
		return sessions.map((s, index) => ({
			id: s.id,
			index,
			title: s.title,
			agent: s.agent,
			isRunning: s.isRunning ?? false,
			createdAt: s.createdAt,
			lastActiveAt: s.lastActiveAt,
			lastViewedAt: s.lastViewedAt ?? null,
			activityAt: s.lastActiveAt ?? s.createdAt,
		}));
	}, [sessions]);

	const sessionMap = useMemo(
		() => new Map(sessions.map((session) => [session.id, session])),
		[sessions],
	);

	const runningSessions = useMemo(
		() => sessionSnapshot.filter((session) => session.isRunning),
		[sessionSnapshot],
	);

	const readyForReviewSessions = useMemo(
		() =>
			sessionSnapshot.filter(
				(session) =>
					!session.isRunning &&
					session.activityAt > (session.lastViewedAt ?? 0),
			),
		[sessionSnapshot],
	);

	const statusSessionIds = useMemo(
		() =>
			new Set(
				[...runningSessions, ...readyForReviewSessions].map(
					(session) => session.id,
				),
			),
		[readyForReviewSessions, runningSessions],
	);

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
			...(readyForReviewSessions.length > 0
				? [
						{
							label: 'Ready for Review',
							sessions: readyForReviewSessions,
						},
					]
				: []),
		],
		[readyForReviewSessions, runningSessions],
	);

	const recentGroups = useMemo(() => {
		const groups = new Map<string, typeof sessionSnapshot>();

		for (const session of sessionSnapshot) {
			if (statusSessionIds.has(session.id)) continue;
			const label = getSessionGroupLabel(session.activityAt);
			const existingSessions = groups.get(label) ?? [];
			existingSessions.push(session);
			groups.set(label, existingSessions);
		}

		return Array.from(groups.entries()).map(([label, groupedSessions]) => ({
			label,
			sessions: groupedSessions,
		}));
	}, [sessionSnapshot, statusSessionIds]);

	useEffect(() => {
		if (currentFocus === 'sessions') {
			const session = sessionSnapshot[sessionIndex];
			if (session) {
				const element = itemRefs.current.get(session.id);
				element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		}
	}, [currentFocus, sessionIndex, sessionSnapshot]);

	const markViewedIfReady = useCallback(
		(sessionId: string) => {
			const session = sessionSnapshot.find((item) => item.id === sessionId);
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
		[markSessionViewed, sessionSnapshot],
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
			sessions.length === 0
		)
			return;

		const activeIndex = sessions.findIndex((s) => s.id === activeSessionId);
		if (activeIndex === -1 && hasNextPage) {
			fetchNextPage();
			return;
		}

		if (activeIndex !== -1) {
			lastScrolledSessionId.current = activeSessionId;
			requestAnimationFrame(() => {
				const element = itemRefs.current.get(activeSessionId);
				element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			});
		}
	}, [activeSessionId, sessions, hasNextPage, fetchNextPage]);

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
				No sessions yet. Create one to get started.
			</div>
		);
	}

	const renderSession = (session: (typeof sessionSnapshot)[0]) => {
		const fullSession = sessionMap.get(session.id);
		if (!fullSession) return null;
		const isFocused =
			currentFocus === 'sessions' && sessionIndex === session.index;

		return (
			<div
				key={session.id}
				ref={(el) => {
					if (el) itemRefs.current.set(session.id, el);
					else itemRefs.current.delete(session.id);
				}}
				className={isFocused ? 'ring-1 ring-inset ring-sidebar-ring/40' : ''}
			>
				<SessionItem
					session={fullSession}
					isActive={session.id === activeSessionId}
					onClick={() => handleSessionClick(session.id)}
				/>
			</div>
		);
	};

	const renderGroup = (group: {
		label: string;
		sessions: typeof sessionSnapshot;
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
			<div className="h-12 shrink-0" aria-hidden="true" />
			<div className="pt-3 pb-1">
				<div className="space-y-4">
					{statusGroups.map((group) => renderGroup(group))}
					{recentGroups.map((group) => renderGroup(group))}
				</div>
			</div>

			{isFetchingNextPage && (
				<div className="flex justify-center py-3">
					<Loader2 className="h-4 w-4 animate-spin text-sidebar-muted-foreground" />
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
