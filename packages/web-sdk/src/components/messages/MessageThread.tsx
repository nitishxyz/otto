import {
	useEffect,
	useRef,
	useState,
	useMemo,
	memo,
	useCallback,
	useLayoutEffect,
	type ReactNode,
} from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
	LegendList,
	type LegendListRef,
	type LegendListRenderItemProps,
} from '@legendapp/list/react';
import type { Message, Session } from '../../types/api';
import { UserMessageGroup } from './UserMessageGroup';
import { ThreadNavigatorRail } from './ThreadNavigatorRail';
import { SessionHeader } from '../sessions/SessionHeader';
import { LeanHeader } from '../sessions/LeanHeader';
import { TopupApprovalCard } from './TopupApprovalCard';
import { usePreferences } from '../../hooks/usePreferences';
import { useQueueState } from '../../hooks/useQueueState';
import { updateMessagesCache } from '../../hooks/useMessages';
import { useTopupApprovalStore } from '../../stores/topupApprovalStore';
import { useTodoStore } from '../../stores/todoStore';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import { useThreadHandoff } from '../../hooks/useSessionHandoff';
import { ThreadDensityProvider } from './threadDensity';
import { apiClient } from '../../lib/api-client';
import { toast } from '../../stores/toastStore';
import {
	TODO_SNAPSHOT_SCAN_MESSAGE_LIMIT,
	filterThreadMessages,
	findLatestTodoSnapshot,
	getTodoSnapshotScanWindow,
} from './threadMessageFilters';
import {
	buildThreadRows,
	createThreadRowCache,
	getThreadRowType,
	type ThreadRow,
} from './threadRowModel';
import {
	AssistantApprovalsRow,
	AssistantCompactGroupRow,
	AssistantContextRow,
	AssistantErrorRow,
	AssistantFooterRow,
	AssistantHeaderRow,
	AssistantItemRow,
	AssistantShowWorkRow,
	AssistantStatusRow,
} from './ThreadRows';
import { useMessageHoverHandlers } from './messageHoverStore';
import { useTurnWorkStore } from './turnWorkStore';
import {
	createPrependRequestState,
	markPrependRequested,
	markPrependSettled,
	resetPrependRequests,
	resolveEndFollow,
	schedulePrependAfterViewportPaint,
	shouldRequestPrepend,
} from './threadPrepend';
import {
	createThreadFollowState,
	reduceThreadFollow,
	type ThreadFollowEvent,
} from './threadFollowState';
interface MessageThreadProps {
	messages: Message[];
	session?: Session;
	sessionId?: string;
	isGenerating?: boolean;
	compact?: boolean;
	responsiveCompact?: boolean;
	disableAutoScroll?: boolean;
	onSelectSession?: (sessionId: string) => void;
	footerBottomPaddingClass?: string;
	/** True while older cursor pages remain unfetched. */
	hasOlderMessages?: boolean;
	isLoadingOlderMessages?: boolean;
	onLoadOlderMessages?: () => void;
	/** Cursor of the next older page; dedupes repeated prepend requests. */
	olderMessagesCursor?: string | null;
}

const LEAN_HEADER_HEIGHT_PX = 48;
const CHAT_INPUT_BOUNDARY_SELECTOR = '[data-chat-input-boundary]';
/**
 * First-frame guess only: once rows are measured the list uses a running
 * average per row *type* (see `getThreadRowType`). It is deliberately closer to
 * a real part row than to a bare line so the initial layout lands near the
 * bottom instead of far above it.
 */
const ESTIMATED_ROW_SIZE_PX = 88;
/**
 * First-frame guess for the list header (session header + the fixed
 * "load earlier" slot + the top spacer). The measured size replaces it, and the
 * header's *structure* never changes afterwards.
 */
const ESTIMATED_HEADER_SIZE_PX = 96;
/**
 * Pre-render buffer around the viewport. Large enough that a fast flick cannot
 * outrun rendering, small enough that a single frame never has to lay out a
 * screenful of markdown at once.
 */
const DRAW_DISTANCE_PX = 1000;
/**
 * Gives LegendList enough room to absorb streamed measurements. Reader intent,
 * rather than this measurement threshold, owns detaching end-follow.
 */
const END_FOLLOW_THRESHOLD = 1;
/** Fixed height for the "load earlier" slot so a fetch cannot resize the header. */
const PREPEND_SLOT_HEIGHT_CLASS = 'h-14';
/** Safety net for a prepend whose fetch never reports a loading state. */
const PREPEND_RELEASE_FALLBACK_MS = 500;
/**
 * How close to the start (as a fraction of the viewport) before the next
 * older page is requested. Small enough that a casual scroll does not load
 * every page at once, large enough that the page is in flight before the
 * reader hits the top.
 */
const START_REACHED_THRESHOLD = 0.15;
/** Floor applied to every row so none can measure as a zero-height item. */
const ROW_MIN_HEIGHT_STYLE = { minHeight: 1 } as const;
/** Stable viewport style; changing object identity is needless list-level churn. */
const LIST_STYLE = { flex: 1, minHeight: 0, height: '100%' } as const;
const PREPEND_FRAME_SCHEDULER = {
	request: (callback: () => void) => requestAnimationFrame(callback),
	cancel: (frame: number) => cancelAnimationFrame(frame),
} as const;
/**
 * Single, lifetime-stable anchoring config. LegendList is the *only* owner of
 * the scroll offset: `data` anchors the visible content across a prepend and
 * `size` across late measurements of rows above the viewport. Toggling this
 * (or correcting the offset by hand) would put two mechanisms on the same
 * insertion, which is exactly what the reader saw as a jump.
 */
const MAINTAIN_VISIBLE_CONTENT_POSITION = { data: true, size: true } as const;

type ScrollViewLike = HTMLElement | { getScrollableNode?: () => HTMLElement };

function resolveScrollElement(node: ScrollViewLike | null): HTMLElement | null {
	if (!node) return null;
	if (node instanceof HTMLElement) return node;
	const scrollable = node.getScrollableNode?.();
	return scrollable instanceof HTMLElement ? scrollable : null;
}

interface ThreadRowRendererProps {
	row: ThreadRow;
	sessionId?: string;
	compact: boolean;
	rowHorizontalClass: string;
	rowBottomClass: string;
	contentWidthClass: string;
	onSelectSession?: (sessionId: string) => void;
	onRetryMessage: (messageId: string) => void;
	onCompact: () => void;
}

/**
 * Thin wrapper around one row. Nothing here depends on the row's index, so
 * inserting older pages above the viewport cannot invalidate a single already
 * rendered row.
 */
const ThreadRowRenderer = memo(function ThreadRowRenderer({
	row,
	sessionId,
	compact,
	rowHorizontalClass,
	rowBottomClass,
	contentWidthClass,
	onSelectSession,
	onRetryMessage,
	onCompact,
}: ThreadRowRendererProps) {
	const hoverHandlers = useMessageHoverHandlers(row.messageId);

	let content: ReactNode = null;
	let indented = true;

	switch (row.kind) {
		case 'user':
			indented = false;
			content = (
				<UserMessageGroup
					sessionId={sessionId}
					message={row.message}
					nextAssistantMessageId={row.nextAssistantMessageId}
				/>
			);
			break;
		case 'assistant-context':
			content = <AssistantContextRow context={row.context} />;
			break;
		case 'assistant-header':
			indented = false;
			content = (
				<AssistantHeaderRow
					sessionId={sessionId}
					message={row.message}
					onBranchCreated={onSelectSession}
				/>
			);
			break;
		case 'assistant-item':
			content = (
				<AssistantItemRow
					messageId={row.messageId}
					part={row.part}
					variant={row.variant}
					showLine={row.showLine}
					isFirstPart={row.isFirstPart}
					isLiveToolCall={row.isLiveToolCall}
					isLastMessage={row.isLastMessage}
					canRetry={row.canRetry}
					sessionId={sessionId}
					compact={compact}
					onNavigateToSession={onSelectSession}
					onRetryMessage={onRetryMessage}
					onCompact={onCompact}
				/>
			);
			break;
		case 'assistant-compact-group':
			content = (
				<AssistantCompactGroupRow
					entries={row.entries}
					titleOverride={row.titleOverride}
					collapsed={row.collapsed}
					showLine={row.showLine}
				/>
			);
			break;
		case 'assistant-approvals':
			content = (
				<AssistantApprovalsRow
					sessionId={sessionId}
					messageId={row.messageId}
				/>
			);
			break;
		case 'assistant-status':
			content = (
				<AssistantStatusRow
					messageId={row.messageId}
					variant={row.variant}
					part={row.part}
					showLine={row.showLine}
					isFirstPart={row.isFirstPart}
					compact={compact}
				/>
			);
			break;
		case 'assistant-error':
			content = <AssistantErrorRow error={row.error} />;
			break;
		case 'assistant-footer':
			indented = false;
			content = (
				<AssistantFooterRow
					sessionId={sessionId}
					message={row.message}
					onBranchCreated={onSelectSession}
				/>
			);
			break;
		case 'assistant-show-work':
			indented = false;
			content = (
				<AssistantShowWorkRow
					messageId={row.messageId}
					expanded={row.expanded}
					compact={compact}
				/>
			);
			break;
		default: {
			// Compile-time exhaustiveness. A row kind added to the model without
			// a case here would otherwise render an empty box, which the list
			// would happily measure as a near-zero item.
			const unhandled: never = row;
			throw new Error(`Unhandled thread row: ${(unhandled as ThreadRow).kind}`);
		}
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: hover state for turn actions
		<div
			data-thread-row-key={row.key}
			className={`group ${rowHorizontalClass} ${row.endsTurn ? rowBottomClass : ''}`}
			// Belt and braces: whatever a row renders, its box stays measurable.
			// A row that measured zero would let the list average its item sizes
			// towards zero and mispredict offsets during a fast scroll.
			style={ROW_MIN_HEIGHT_STYLE}
			onMouseEnter={hoverHandlers.onMouseEnter}
			onMouseLeave={hoverHandlers.onMouseLeave}
		>
			<div
				data-smart-edge-ignore="left"
				data-smart-edge-ignore-mode="content"
				className={contentWidthClass}
			>
				{indented ? <div className="relative ml-1">{content}</div> : content}
			</div>
		</div>
	);
});

export const MessageThread = memo(function MessageThread({
	messages,
	session,
	sessionId,
	isGenerating,
	compact = false,
	responsiveCompact = true,
	disableAutoScroll = false,
	onSelectSession,
	footerBottomPaddingClass: footerBottomPaddingClassOverride,
	hasOlderMessages = false,
	isLoadingOlderMessages = false,
	onLoadOlderMessages,
	olderMessagesCursor = null,
}: MessageThreadProps) {
	const queryClient = useQueryClient();
	const { preferences } = usePreferences();
	const listRef = useRef<LegendListRef>(null);
	const scrollContainerRef = useRef<HTMLElement | null>(null);
	const sessionHeaderRef = useRef<HTMLDivElement>(null);
	const threadRootRef = useRef<HTMLDivElement>(null);
	const threadWidth = useContainerWidth(threadRootRef);
	useThreadHandoff(sessionId, threadRootRef);
	const density: 'normal' | 'compact' =
		compact || (responsiveCompact && threadWidth > 0 && threadWidth < 640)
			? 'compact'
			: 'normal';
	// The intent latch decides whether LegendList may follow. Streamed height
	// changes never mutate it; only reader scrolling and explicit bottom
	// requests do.
	const followStateRef = useRef(createThreadFollowState());
	const [following, setFollowing] = useState(true);
	const [showLeanHeader, setShowLeanHeader] = useState(false);
	const [railInsets, setRailInsets] = useState({ top: 0, bottom: 0 });
	// Row identity is cached per thread instance. A shared cache would let a
	// second mounted thread (subagent viewer, canvas block, desktop pane) evict
	// these rows on every rebuild and force LegendList to re-measure everything.
	const rowCacheRef = useRef(createThreadRowCache());
	// Prepend bookkeeping: dedupes older-page requests by cursor and suspends
	// end-following while a page is in flight. It never touches the scroll
	// offset — LegendList's `maintainVisibleContentPosition` owns that.
	const prependStateRef = useRef(createPrependRequestState());
	const prependFetchStartedRef = useRef(false);
	const cancelPrependDispatchRef = useRef<() => void>(() => {});
	const didPrefetchOnDetachRef = useRef(false);
	const [isPrepending, setIsPrepending] = useState(false);
	const chromeFrameRef = useRef<number | undefined>(undefined);
	const lastSessionIdRef = useRef<string | undefined>(sessionId);
	// Ids of the optimistic user messages already seen. A *new* one can only
	// come from this reader pressing send, which explicitly returns to the end.
	const seenOptimisticIdsRef = useRef<Set<string>>(new Set());
	const optimisticSendsInitializedRef = useRef(false);

	const expandedWorkMessageIds = useTurnWorkStore(
		(state) => state.expandedMessageIds,
	);
	const clearExpandedWork = useTurnWorkStore((state) => state.clearExpanded);
	const pendingTopup = useTopupApprovalStore((s) => s.pendingTopup);
	const clearPendingTopup = useTopupApprovalStore((s) => s.clearPendingTopup);
	const setSessionTodos = useTodoStore((s) => s.setSessionTodos);
	const queueState = useQueueState(sessionId);
	const queuedMessageIds = useMemo(
		() => new Set(queueState.queuedMessages.map((item) => item.messageId)),
		[queueState.queuedMessages],
	);

	const showTopupApproval =
		pendingTopup && pendingTopup.sessionId === sessionId;
	const todoSnapshotScanMessages = useMemo(
		() => getTodoSnapshotScanWindow(messages),
		[messages],
	);
	const latestTodoSnapshot = useMemo(
		() => findLatestTodoSnapshot(todoSnapshotScanMessages, queuedMessageIds),
		[todoSnapshotScanMessages, queuedMessageIds],
	);
	const filteredMessages = useMemo(() => {
		return filterThreadMessages(
			messages,
			queueState.currentMessageId,
			queueState.queueLength,
			queuedMessageIds,
		);
	}, [
		messages,
		queueState.currentMessageId,
		queueState.queueLength,
		queuedMessageIds,
	]);
	const hasMessages = messages.length > 0;

	const dispatchFollow = useCallback((event: ThreadFollowEvent) => {
		const previous = followStateRef.current;
		const next = reduceThreadFollow(previous, event);
		if (next === previous) return;
		followStateRef.current = next;
		if (next.following !== previous.following) setFollowing(next.following);
	}, []);

	const disableAutoFollow = useCallback(() => {
		dispatchFollow({ type: 'scrolled-up' });
	}, [dispatchFollow]);

	useEffect(() => {
		if (!sessionId) return;
		if (
			latestTodoSnapshot ||
			messages.length <= TODO_SNAPSHOT_SCAN_MESSAGE_LIMIT
		) {
			setSessionTodos(sessionId, latestTodoSnapshot);
		}
	}, [latestTodoSnapshot, messages.length, sessionId, setSessionTodos]);

	const cancelPendingPrependDispatch = useCallback(() => {
		cancelPrependDispatchRef.current();
		cancelPrependDispatchRef.current = () => {};
	}, []);

	const updateRailInsets = useCallback(
		(leanHeaderVisible = showLeanHeader) => {
			const root = threadRootRef.current;
			if (!root) return;

			const rootRect = root.getBoundingClientRect();
			const rootHeight = rootRect.height;
			let top = leanHeaderVisible ? LEAN_HEADER_HEIGHT_PX : 0;

			const headerElement = sessionHeaderRef.current;
			if (headerElement) {
				const headerRect = headerElement.getBoundingClientRect();
				if (headerRect.bottom > rootRect.top) {
					top = Math.max(
						top,
						Math.min(headerRect.bottom, rootRect.bottom) - rootRect.top,
					);
				}
			}

			let bottom = 0;
			const inputBoundary = root.parentElement?.querySelector(
				CHAT_INPUT_BOUNDARY_SELECTOR,
			);
			if (inputBoundary instanceof HTMLElement) {
				const inputRect = inputBoundary.getBoundingClientRect();
				if (inputRect.top < rootRect.bottom) {
					bottom = rootRect.bottom - Math.max(inputRect.top, rootRect.top);
				}
			}

			const nextTop = Math.max(0, Math.min(rootHeight, top));
			const nextBottom = Math.max(
				0,
				Math.min(Math.max(0, rootHeight - nextTop), bottom),
			);
			setRailInsets((previous) => {
				if (
					Math.abs(previous.top - nextTop) < 1 &&
					Math.abs(previous.bottom - nextBottom) < 1
				) {
					return previous;
				}
				return { top: nextTop, bottom: nextBottom };
			});
		},
		[showLeanHeader],
	);

	const handleScroll = useCallback(() => {
		const container = scrollContainerRef.current;
		if (!container) return;
		const { scrollTop, scrollHeight, clientHeight } = container;
		dispatchFollow({
			type: 'scrolled',
			scrollTop,
			distanceFromBottom: scrollHeight - scrollTop - clientHeight,
		});

		// The lean header + rail insets need getBoundingClientRect reads, which
		// force synchronous layout. Coalesce to at most one update per frame.
		if (chromeFrameRef.current !== undefined) return;
		chromeFrameRef.current = requestAnimationFrame(() => {
			chromeFrameRef.current = undefined;
			const scroller = scrollContainerRef.current;
			if (!scroller) return;
			const headerElement = sessionHeaderRef.current;
			let nextShowLeanHeader = showLeanHeader;
			if (headerElement) {
				const headerRect = headerElement.getBoundingClientRect();
				const containerRect = scroller.getBoundingClientRect();
				nextShowLeanHeader = headerRect.bottom < containerRect.top;
			} else {
				// No session (embedded thread): fall back to a scroll offset check.
				nextShowLeanHeader = scroller.scrollTop > LEAN_HEADER_HEIGHT_PX;
			}
			setShowLeanHeader(nextShowLeanHeader);
			updateRailInsets(nextShowLeanHeader);
		});
	}, [dispatchFollow, showLeanHeader, updateRailInsets]);

	// Wheel and touch direction are immediate user-intent signals. The scroll
	// sample above remains the fallback for keyboard and scrollbar movement.
	const lastTouchYRef = useRef(0);
	const handleWheelIntent = useCallback(
		(event: WheelEvent) => {
			if (
				event.deltaY < 0 &&
				(scrollContainerRef.current?.scrollTop ?? 0) > 0
			) {
				disableAutoFollow();
			}
		},
		[disableAutoFollow],
	);
	const handleTouchStartIntent = useCallback((event: TouchEvent) => {
		lastTouchYRef.current = event.touches[0]?.clientY ?? 0;
	}, []);
	const handleTouchMoveIntent = useCallback(
		(event: TouchEvent) => {
			const y = event.touches[0]?.clientY ?? 0;
			if (
				y > lastTouchYRef.current + 2 &&
				(scrollContainerRef.current?.scrollTop ?? 0) > 0
			) {
				disableAutoFollow();
			}
			lastTouchYRef.current = y;
		},
		[disableAutoFollow],
	);

	const detachScrollListenerRef = useRef<(() => void) | undefined>(undefined);
	const attachScrollListener = useCallback(
		(node: ScrollViewLike | null) => {
			if (detachScrollListenerRef.current) {
				detachScrollListenerRef.current();
				detachScrollListenerRef.current = undefined;
			}
			const element = resolveScrollElement(node);
			scrollContainerRef.current = element;
			if (!element) return;
			element.addEventListener('scroll', handleScroll, { passive: true });
			element.addEventListener('wheel', handleWheelIntent, { passive: true });
			element.addEventListener('touchstart', handleTouchStartIntent, {
				passive: true,
			});
			element.addEventListener('touchmove', handleTouchMoveIntent, {
				passive: true,
			});
			detachScrollListenerRef.current = () => {
				element.removeEventListener('scroll', handleScroll);
				element.removeEventListener('wheel', handleWheelIntent);
				element.removeEventListener('touchstart', handleTouchStartIntent);
				element.removeEventListener('touchmove', handleTouchMoveIntent);
			};
		},
		[
			handleScroll,
			handleTouchMoveIntent,
			handleTouchStartIntent,
			handleWheelIntent,
		],
	);

	useLayoutEffect(() => {
		updateRailInsets(showLeanHeader);

		const handleResize = () => updateRailInsets(showLeanHeader);
		const root = threadRootRef.current;
		const inputBoundary = root?.parentElement?.querySelector(
			CHAT_INPUT_BOUNDARY_SELECTOR,
		);
		const headerElement = sessionHeaderRef.current;
		window.addEventListener('resize', handleResize);

		if (typeof ResizeObserver === 'undefined') {
			return () => window.removeEventListener('resize', handleResize);
		}

		const resizeObserver = new ResizeObserver(handleResize);
		if (root) resizeObserver.observe(root);
		if (inputBoundary instanceof HTMLElement)
			resizeObserver.observe(inputBoundary);
		if (headerElement) resizeObserver.observe(headerElement);

		return () => {
			window.removeEventListener('resize', handleResize);
			resizeObserver.disconnect();
		};
	}, [showLeanHeader, updateRailInsets]);

	// LegendList stays mounted across session switches and resets its internal
	// dataset through `dataKey`. This effect only resets Otto's per-session
	// bookkeeping — it never scrolls. A React key remount would throw away the
	// list's viewport/container state and can expose a blank frame while the new
	// conversation is measured.
	useLayoutEffect(() => {
		if (sessionId === lastSessionIdRef.current) return;
		lastSessionIdRef.current = sessionId;
		cancelPendingPrependDispatch();
		dispatchFollow({ type: 'reset' });
		seenOptimisticIdsRef.current = new Set();
		optimisticSendsInitializedRef.current = false;
		setIsPrepending(false);
		didPrefetchOnDetachRef.current = false;
		prependFetchStartedRef.current = false;
		resetPrependRequests(prependStateRef.current);
		setShowLeanHeader(false);
		setRailInsets({ top: 0, bottom: 0 });
		clearExpandedWork();
	}, [
		sessionId,
		cancelPendingPrependDispatch,
		clearExpandedWork,
		dispatchFollow,
	]);

	// The *only* content-driven re-arm: this reader pressing send. An optimistic
	// user message appears exactly once per send from this client, which makes
	// it a real intent signal — unlike "a turn started generating", which also
	// fires for queued turns and for work this reader never asked to watch.
	// One imperative scroll, never a loop, and never while a prepend is in
	// flight.
	useEffect(() => {
		const seen = seenOptimisticIdsRef.current;
		const live = new Set<string>();
		let didSend = false;
		// Optimistic sends are always appended, so they form a contiguous run at
		// the tail. Scanning backwards keeps this O(sends) instead of O(thread)
		// on every streamed delta.
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index];
			if (!message.optimistic) break;
			if (message.role !== 'user') continue;
			live.add(message.id);
			if (!seen.has(message.id)) didSend = true;
		}
		seenOptimisticIdsRef.current = live;
		// The first pass only records what was already in the cache: mounting a
		// thread that happens to hold an in-flight send is not a send.
		if (!optimisticSendsInitializedRef.current) {
			optimisticSendsInitializedRef.current = true;
			return;
		}
		if (!didSend || disableAutoScroll) return;
		if (isPrepending || isLoadingOlderMessages) return;
		dispatchFollow({ type: 'bottom-requested' });
		void listRef.current?.scrollToEnd({ animated: false });
	}, [
		messages,
		disableAutoScroll,
		isPrepending,
		isLoadingOlderMessages,
		dispatchFollow,
	]);

	useEffect(() => {
		return () => {
			cancelPendingPrependDispatch();
			if (chromeFrameRef.current !== undefined) {
				cancelAnimationFrame(chromeFrameRef.current);
				chromeFrameRef.current = undefined;
			}
			if (detachScrollListenerRef.current) {
				detachScrollListenerRef.current();
				detachScrollListenerRef.current = undefined;
			}
		};
	}, [cancelPendingPrependDispatch]);

	const scrollToBottom = useCallback(() => {
		dispatchFollow({ type: 'bottom-requested' });
		void listRef.current?.scrollToEnd({ animated: true });
	}, [dispatchFollow]);

	const contentWidthClass = preferences.fullWidthContent
		? compact
			? 'w-full space-y-4'
			: 'w-full space-y-6'
		: compact
			? 'max-w-3xl mx-auto space-y-4'
			: 'max-w-3xl mx-auto space-y-6';
	// The navigator rail always sits on the LEFT edge and is narrow in roomy
	// mode. The whole assistant turn (avatar/header pill, timeline, text) starts
	// at the row's left padding edge, so reserve a symmetric horizontal inset on
	// the row wrapper wide enough to clear the rail on the left and mirror it on
	// the right. Use explicit pl-*/pr-* only (never px-* + pl-*) to avoid
	// Tailwind padding-left conflicts. Compact density keeps the thin far-left
	// dots, so it stays on the tight px-2 spacing.
	const rowHorizontalClass = density === 'compact' ? 'px-2' : 'pl-14 pr-14';
	const rowBottomClass =
		density === 'compact' ? 'pb-3' : compact ? 'pb-4' : 'pb-6';
	const firstRowTopClass =
		density === 'compact' ? 'pt-3' : compact ? 'pt-4' : 'pt-6';
	const footerBottomPaddingClass =
		footerBottomPaddingClassOverride ??
		(density === 'compact' || compact ? 'pb-80' : 'pb-96');

	// Create a retry handler for error messages
	const handleRetryMessage = useCallback(
		(messageId: string) => {
			if (!sessionId || !messageId) return;

			updateMessagesCache(queryClient, sessionId, (oldMessages) =>
				oldMessages.map((msg) => {
					if (msg.id !== messageId) return msg;
					const partsToKeep =
						msg.parts?.filter((part) => {
							if (part.type === 'error') return false;
							if (part.type === 'tool_call' && part.toolName === 'finish')
								return false;
							return true;
						}) ?? [];
					return {
						...msg,
						status: 'pending' as const,
						parts: partsToKeep,
						error: null,
					};
				}),
			);

			void apiClient.retryMessage(sessionId, messageId).catch((error) => {
				toast.error(error instanceof Error ? error.message : 'Failed to retry');
			});
		},
		[sessionId, queryClient],
	);

	const handleCompact = useCallback(async () => {
		if (!sessionId) return;
		try {
			await apiClient.sendMessage(sessionId, { content: '/compact' });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to compact');
		}
	}, [sessionId]);

	const { rows, rowIndexByMessageIndex } = useMemo(
		() =>
			buildThreadRows({
				messages: filteredMessages,
				sessionId,
				compact,
				currentMessageId: queueState.currentMessageId,
				queueLength: queueState.queueLength,
				queuedMessageIds,
				cache: rowCacheRef.current,
				expandedWorkMessageIds,
			}),
		[
			filteredMessages,
			sessionId,
			compact,
			queueState.currentMessageId,
			queueState.queueLength,
			queuedMessageIds,
			expandedWorkMessageIds,
		],
	);

	// A settled fetch releases the latch. The cursor stays recorded so a burst
	// of `onStartReached` cannot re-request the same page; a *new* page
	// advances the cursor, which unlatches naturally. Releasing never scrolls:
	// the inserted rows were already anchored by the list itself.
	useEffect(() => {
		if (isLoadingOlderMessages) {
			prependFetchStartedRef.current = true;
			return;
		}
		if (!isPrepending) {
			markPrependSettled(prependStateRef.current);
			return;
		}
		if (prependFetchStartedRef.current) {
			prependFetchStartedRef.current = false;
			markPrependSettled(prependStateRef.current);
			setIsPrepending(false);
			return;
		}
		// Safety net: a page answered straight from cache may never flip the
		// loading flag, and a stuck suspension would leave end-following off for
		// good. Release late rather than never — still without scrolling.
		const handle = setTimeout(() => {
			markPrependSettled(prependStateRef.current);
			setIsPrepending(false);
		}, PREPEND_RELEASE_FALLBACK_MS);
		return () => clearTimeout(handle);
	}, [isLoadingOlderMessages, isPrepending]);

	const handleNavigateToIndex = useCallback(
		(messageIndex: number) => {
			disableAutoFollow();
			const rowIndex = rowIndexByMessageIndex[messageIndex] ?? 0;
			void listRef.current?.scrollToIndex({
				index: rowIndex,
				viewPosition: 0,
				animated: true,
			});
		},
		[disableAutoFollow, rowIndexByMessageIndex],
	);

	/**
	 * Asks for the next older page. `onStartReached` fires repeatedly while the
	 * reader sits inside the start threshold — the list owns that hysteresis,
	 * this owns the cursor latch, so exactly one fetch per page goes out.
	 *
	 * Nothing here measures or writes the scroll offset: the page is inserted
	 * above the viewport and LegendList's `maintainVisibleContentPosition`
	 * keeps the visible content exactly where it was.
	 */
	const requestOlderMessages = useCallback(() => {
		if (
			!shouldRequestPrepend(prependStateRef.current, {
				token: olderMessagesCursor,
				hasOlder: hasOlderMessages,
				isLoading: isLoadingOlderMessages,
			})
		) {
			return;
		}
		markPrependRequested(prependStateRef.current, olderMessagesCursor);
		// A scrollbar drag can jump farther than the mounted range. Legend List
		// fills that new visible range on the next frame. Starting a cached/fast
		// page fetch in the same scroll turn can commit the prepend before that
		// paint and leave the viewport blank while the large page renders. Give
		// the list one full paint first, then fetch — never cover the thread.
		cancelPendingPrependDispatch();
		cancelPrependDispatchRef.current = schedulePrependAfterViewportPaint(() => {
			cancelPrependDispatchRef.current = () => {};
			setIsPrepending(true);
			onLoadOlderMessages?.();
		}, PREPEND_FRAME_SCHEDULER);
	}, [
		olderMessagesCursor,
		hasOlderMessages,
		isLoadingOlderMessages,
		onLoadOlderMessages,
		cancelPendingPrependDispatch,
	]);

	// Warm the next older page as soon as the reader leaves the live edge so
	// the first scroll-up does not stall on a fetch. Only one page is
	// prefetched per detach; further pages wait for `onStartReached`.
	useEffect(() => {
		if (following || disableAutoScroll) {
			didPrefetchOnDetachRef.current = false;
			return;
		}
		if (didPrefetchOnDetachRef.current) return;
		if (!hasOlderMessages) return;
		didPrefetchOnDetachRef.current = true;
		requestOlderMessages();
	}, [following, disableAutoScroll, hasOlderMessages, requestOlderMessages]);

	// Follow only while the reader is still on the live edge. A prepend must
	// not flip this: turning it back on after older rows land is what snaps
	// the viewport back to the bottom.
	const maintainScrollAtEnd = resolveEndFollow({
		disabled: disableAutoScroll,
		detached: !following,
	});

	const keyExtractor = useCallback((row: ThreadRow) => row.key, []);
	const rowsAreEqual = useCallback(
		(previous: ThreadRow, next: ThreadRow) => previous === next,
		[],
	);
	// Rows differ in height by an order of magnitude (a one-line suppressed
	// placeholder vs. a long markdown answer vs. a collapsed activity summary).
	// Typing them by *presentation* lets the list keep a size average per
	// class, so the offsets it predicts for not-yet-measured rows during a fast
	// flick stay close to reality instead of collapsing to one global average —
	// which is what shows up as a blank row.
	const getItemType = useCallback(
		(row: ThreadRow) => getThreadRowType(row),
		[],
	);

	const renderRow = useCallback(
		({ item }: LegendListRenderItemProps<ThreadRow>) => (
			<ThreadRowRenderer
				row={item}
				sessionId={sessionId}
				compact={compact}
				rowHorizontalClass={rowHorizontalClass}
				rowBottomClass={rowBottomClass}
				contentWidthClass={contentWidthClass}
				onSelectSession={onSelectSession}
				onRetryMessage={handleRetryMessage}
				onCompact={handleCompact}
			/>
		),
		[
			sessionId,
			compact,
			rowHorizontalClass,
			rowBottomClass,
			contentWidthClass,
			onSelectSession,
			handleRetryMessage,
			handleCompact,
		],
	);

	// The header's *structure* is invariant for the whole session: the session
	// header, a fixed-height "load earlier" slot and the top spacer are always
	// mounted, in that order. Only the slot's contents change (button ↔ spinner
	// ↔ nothing), never its height and never the composition — so a page
	// landing, or `hasOlderMessages` flipping to false, cannot shift every row
	// below the header.
	const listHeader = useMemo(
		() => (
			<>
				{session && (
					<div ref={sessionHeaderRef}>
						<SessionHeader
							session={session}
							isGenerating={isGenerating}
							onNavigateToSession={onSelectSession}
						/>
					</div>
				)}
				<div
					className={`flex items-center justify-center ${PREPEND_SLOT_HEIGHT_CLASS}`}
				>
					{hasOlderMessages ? (
						<button
							type="button"
							onClick={requestOlderMessages}
							disabled={isLoadingOlderMessages}
							className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-70"
						>
							<Loader2
								className={`h-3 w-3 ${
									isLoadingOlderMessages ? 'animate-spin' : 'opacity-0'
								}`}
							/>
							{isLoadingOlderMessages
								? 'Loading earlier messages…'
								: 'Load earlier messages'}
						</button>
					) : null}
				</div>
				<div className={firstRowTopClass} />
			</>
		),
		[
			hasOlderMessages,
			isLoadingOlderMessages,
			requestOlderMessages,
			session,
			isGenerating,
			onSelectSession,
			firstRowTopClass,
		],
	);

	const listFooter = useMemo(
		() => (
			<div className={footerBottomPaddingClass}>
				{showTopupApproval && pendingTopup && (
					<div className={`${rowHorizontalClass} ${rowBottomClass}`}>
						<div className={contentWidthClass}>
							<div className="py-4">
								<TopupApprovalCard
									pendingTopup={pendingTopup}
									onMethodSelected={() => clearPendingTopup()}
									onCancel={() => clearPendingTopup()}
								/>
							</div>
						</div>
					</div>
				)}
			</div>
		),
		[
			footerBottomPaddingClass,
			showTopupApproval,
			pendingTopup,
			clearPendingTopup,
			rowHorizontalClass,
			rowBottomClass,
			contentWidthClass,
		],
	);

	if (!hasMessages) {
		return (
			<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
				No messages yet. Start a conversation below.
			</div>
		);
	}

	return (
		<div ref={threadRootRef} className="absolute inset-0 flex flex-col">
			<ThreadDensityProvider density={density}>
				{/* Lean Header - shows when session header scrolls off - positioned within thread */}
				{session && (
					<LeanHeader
						session={session}
						isVisible={showLeanHeader}
						isGenerating={isGenerating}
						onNavigateToSession={onSelectSession}
					/>
				)}

				<LegendList
					ref={listRef}
					className="scrollbar-hide"
					style={LIST_STYLE}
					data={rows}
					// Reset list layout state for a different conversation without
					// remounting the DOM subtree. v3.3.5 fixes stale/invisible rows when
					// switching non-empty datasets through this supported path.
					dataKey={sessionId ?? 'thread'}
					keyExtractor={keyExtractor}
					itemsAreEqual={rowsAreEqual}
					getItemType={getItemType}
					renderItem={renderRow}
					estimatedItemSize={ESTIMATED_ROW_SIZE_PX}
					estimatedHeaderSize={ESTIMATED_HEADER_SIZE_PX}
					drawDistance={DRAW_DISTANCE_PX}
					recycleItems={false}
					// Sole owner of the initial position; no imperative burst races it.
					initialScrollAtEnd
					maintainScrollAtEnd={maintainScrollAtEnd}
					maintainScrollAtEndThreshold={END_FOLLOW_THRESHOLD}
					// Never toggled: one anchoring owner for the list's whole lifetime.
					maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
					onStartReached={requestOlderMessages}
					onStartReachedThreshold={START_REACHED_THRESHOLD}
					ListHeaderComponent={listHeader}
					ListFooterComponent={listFooter}
					refScrollView={attachScrollListener}
				/>

				{preferences.threadNavigatorRail && (
					<ThreadNavigatorRail
						messages={filteredMessages}
						onNavigate={handleNavigateToIndex}
						threadWidth={threadWidth}
						topInset={railInsets.top}
						bottomInset={railInsets.bottom}
					/>
				)}

				{/* Scroll to bottom button - only shown when user has scrolled up */}
				{!following && (
					<button
						type="button"
						onClick={scrollToBottom}
						className="absolute bottom-36 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-background border border-border rounded-full shadow-lg hover:bg-muted/50 transition-all text-sm text-foreground z-10"
					>
						<ArrowDown className="w-4 h-4" />
						<span>Scroll to bottom</span>
					</button>
				)}
			</ThreadDensityProvider>
		</div>
	);
});
