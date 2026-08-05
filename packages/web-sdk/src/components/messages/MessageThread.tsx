import {
	useEffect,
	useRef,
	useState,
	useMemo,
	memo,
	useCallback,
	useLayoutEffect,
	type RefObject,
} from 'react';
import { ArrowDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Virtuoso, type Components, type VirtuosoHandle } from 'react-virtuoso';
import type { Message, MessagePart, Session } from '../../types/api';
import { AssistantMessageGroup } from './AssistantMessageGroup';
import { UserMessageGroup } from './UserMessageGroup';
import { ThreadNavigatorRail } from './ThreadNavigatorRail';
import { SessionHeader } from '../sessions/SessionHeader';
import { LeanHeader } from '../sessions/LeanHeader';
import { TopupApprovalCard } from './TopupApprovalCard';
import { usePreferences } from '../../hooks/usePreferences';
import { useQueueState } from '../../hooks/useQueueState';
import { getMessagesQueryKey } from '../../hooks/useMessages';
import { useTopupApprovalStore } from '../../stores/topupApprovalStore';
import {
	useTodoStore,
	type TodoItem,
	type TodoSnapshot,
} from '../../stores/todoStore';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import { useThreadHandoff } from '../../hooks/useSessionHandoff';
import { ThreadDensityProvider } from './threadDensity';
import { apiClient } from '../../lib/api-client';
import { toast } from '../../stores/toastStore';
import { getUserMessageText, isCompactSlashCommand } from './compactionSummary';

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
}

const TODO_TOOL_NAMES = new Set([
	'update_todos',
	'update_plan',
	'UpdateTodos',
	'UpdatePlan',
]);

// True bottom tolerance. Auto-follow only resumes when the user is essentially
// pinned to the bottom, not merely "near" it. Resuming inside a large band is
// what made the thread yank the user back down mid-stream.
const BOTTOM_RESUME_THRESHOLD_PX = 8;
const LEAN_HEADER_HEIGHT_PX = 48;
const CHAT_INPUT_BOUNDARY_SELECTOR = '[data-chat-input-boundary]';

const TODO_SNAPSHOT_SCAN_MESSAGE_LIMIT = 12;
const TODO_SNAPSHOT_SCAN_PART_LIMIT = 500;

function parseToolResultContent(
	part: MessagePart,
): Record<string, unknown> | null {
	if (part.contentJson && typeof part.contentJson === 'object') {
		return part.contentJson;
	}
	try {
		const parsed = JSON.parse(part.content);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {}
	return null;
}

function isTodoStatus(status: unknown): status is TodoItem['status'] {
	return (
		status === 'pending' ||
		status === 'in_progress' ||
		status === 'completed' ||
		status === 'cancelled'
	);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizeTodoItems(rawItems: unknown): TodoItem[] | null {
	if (!Array.isArray(rawItems)) return null;
	const items = rawItems.flatMap((item): TodoItem[] => {
		if (typeof item === 'string') {
			const step = item.trim();
			return step ? [{ step, status: 'pending' }] : [];
		}
		const record = asRecord(item);
		if (!record) return [];
		const rawStep =
			typeof record.step === 'string'
				? record.step
				: typeof record.description === 'string'
					? record.description
					: '';
		const step = rawStep.trim();
		if (!step) return [];
		return [
			{
				step,
				status: isTodoStatus(record.status) ? record.status : 'pending',
			},
		];
	});
	return items.length > 0 ? items : null;
}

function getTodoToolName(
	part: MessagePart,
	content: Record<string, unknown> | null,
) {
	const name = part.toolName ?? content?.name;
	return typeof name === 'string' ? name : null;
}

function parseTodoSnapshot(
	content: Record<string, unknown>,
): Omit<TodoSnapshot, 'updatedAt'> | null {
	const result = asRecord(content.result) ?? content;
	const args = asRecord(content.args);
	const sources = [
		{ rawItems: result.items, note: result.note },
		{ rawItems: content.items, note: content.note },
		{ rawItems: args?.todos, note: args?.note },
	];

	for (const source of sources) {
		const items = normalizeTodoItems(source.rawItems);
		if (items) {
			return {
				items,
				note: typeof source.note === 'string' ? source.note : undefined,
			};
		}
	}

	return null;
}

function isTodoSnapshotDone(snapshot: Omit<TodoSnapshot, 'updatedAt'>) {
	return (
		snapshot.items.length > 0 &&
		snapshot.items.every(
			(item) => item.status === 'completed' || item.status === 'cancelled',
		)
	);
}

function isQueuedUserMessage(
	messages: Message[],
	messageIndex: number,
	queuedMessageIds: Set<string>,
) {
	const nextAssistant = messages
		.slice(messageIndex + 1)
		.find((message) => message.role === 'assistant');
	return Boolean(nextAssistant && queuedMessageIds.has(nextAssistant.id));
}

function findLatestTodoSnapshot(
	messages: Message[],
	queuedMessageIds: Set<string>,
): Omit<TodoSnapshot, 'updatedAt'> | null {
	let hasNewerUserMessage = false;

	for (
		let messageIndex = messages.length - 1;
		messageIndex >= 0;
		messageIndex--
	) {
		const message = messages[messageIndex];
		if (
			message?.role === 'user' &&
			!isQueuedUserMessage(messages, messageIndex, queuedMessageIds)
		) {
			hasNewerUserMessage = true;
		}

		const parts = message?.parts ?? [];
		const firstPartIndex = Math.max(
			0,
			parts.length - TODO_SNAPSHOT_SCAN_PART_LIMIT,
		);
		for (
			let partIndex = parts.length - 1;
			partIndex >= firstPartIndex;
			partIndex--
		) {
			const part = parts[partIndex];
			if (part.type !== 'tool_result') continue;
			const content = parseToolResultContent(part);
			const toolName = getTodoToolName(part, content);
			if (!toolName || !TODO_TOOL_NAMES.has(toolName)) continue;
			if (!content) return null;
			const snapshot = parseTodoSnapshot(content);
			if (!snapshot) return null;
			if (hasNewerUserMessage && isTodoSnapshotDone(snapshot)) return null;
			return snapshot;
		}
	}
	return null;
}

function getTodoSnapshotScanWindow(messages: Message[]) {
	if (messages.length <= TODO_SNAPSHOT_SCAN_MESSAGE_LIMIT) return messages;
	return messages.slice(-TODO_SNAPSHOT_SCAN_MESSAGE_LIMIT);
}

function isVisibleThreadMessage(message: Message) {
	return (
		message.role !== 'system' &&
		!(
			message.role === 'assistant' &&
			message.status === 'complete' &&
			(message.parts?.length ?? 0) === 0
		)
	);
}

function isPendingEmptyAssistant(
	message: Message,
	currentMessageId: string | null,
) {
	return (
		message.role === 'assistant' &&
		message.status === 'pending' &&
		(message.parts?.length ?? 0) === 0 &&
		message.id !== currentMessageId
	);
}

function isActiveAssistantMessage(
	message: Message,
	currentMessageId: string | null,
	queuedMessageIds: Set<string>,
) {
	return (
		message.role === 'assistant' &&
		(message.id === currentMessageId ||
			(message.status === 'pending' && !queuedMessageIds.has(message.id)))
	);
}

function filterThreadMessages(
	messages: Message[],
	currentMessageId: string | null,
	queueLength: number,
	queuedMessageIds: Set<string>,
) {
	const visibleMessages = messages.filter(isVisibleThreadMessage);
	const queueBusy = Boolean(currentMessageId) || queueLength > 0;

	if (!queueBusy) return visibleMessages;

	const nextAssistantByIndex = new Array<Message | undefined>(
		visibleMessages.length,
	);
	let nextAssistant: Message | undefined;
	for (let index = visibleMessages.length - 1; index >= 0; index--) {
		nextAssistantByIndex[index] = nextAssistant;
		const message = visibleMessages[index];
		if (message?.role === 'assistant') {
			nextAssistant = message;
		}
	}

	const hasEarlierActiveAssistantByIndex = new Array<boolean>(
		visibleMessages.length,
	);
	let hasEarlierActiveAssistant = false;
	for (let index = 0; index < visibleMessages.length; index++) {
		hasEarlierActiveAssistantByIndex[index] = hasEarlierActiveAssistant;
		const message = visibleMessages[index];
		if (
			message &&
			isActiveAssistantMessage(message, currentMessageId, queuedMessageIds)
		) {
			hasEarlierActiveAssistant = true;
		}
	}

	return visibleMessages.filter((message, index) => {
		if (message.role === 'assistant') {
			return !isPendingEmptyAssistant(message, currentMessageId);
		}

		if (message.role !== 'user') return true;

		const nextAssistant = nextAssistantByIndex[index];
		if (nextAssistant) {
			const nextAssistantIsQueued =
				queuedMessageIds.has(nextAssistant.id) ||
				isPendingEmptyAssistant(nextAssistant, currentMessageId);
			return !nextAssistantIsQueued;
		}

		return !hasEarlierActiveAssistantByIndex[index];
	});
}

interface ThreadMessageRowProps {
	sessionId?: string;
	message: Message;
	previousMessage?: Message;
	nextMessage?: Message;
	isFirst: boolean;
	isLastMessage: boolean;
	currentMessageId: string | null;
	queueLength: number;
	compact: boolean;
	onSelectSession?: (sessionId: string) => void;
	createRetryHandler: (messageId: string) => () => Promise<void>;
	onCompact: () => Promise<void>;
}

const ThreadMessageRow = memo(function ThreadMessageRow({
	sessionId,
	message,
	previousMessage,
	nextMessage,
	isFirst,
	isLastMessage,
	currentMessageId,
	queueLength,
	compact,
	onSelectSession,
	createRetryHandler,
	onCompact,
}: ThreadMessageRowProps) {
	const nextAssistantMessage =
		nextMessage && nextMessage.role === 'assistant' ? nextMessage : undefined;
	const hasQueuedOrRunningLaterTurn = Boolean(
		currentMessageId && currentMessageId !== message.id,
	);
	const canRetryTurn =
		message.role === 'assistant' &&
		isLastMessage &&
		!hasQueuedOrRunningLaterTurn &&
		queueLength === 0;
	const retryHandler = useMemo(
		() => (canRetryTurn ? createRetryHandler(message.id) : undefined),
		[canRetryTurn, createRetryHandler, message.id],
	);

	if (message.role === 'user') {
		return (
			<UserMessageGroup
				sessionId={sessionId}
				message={message}
				isFirst={isFirst}
				nextAssistantMessageId={nextAssistantMessage?.id}
			/>
		);
	}

	if (message.role === 'assistant') {
		const previousUserMessage =
			previousMessage?.role === 'user' ? previousMessage : undefined;
		const isCompactCommandResult = isCompactSlashCommand(
			getUserMessageText(previousUserMessage),
		);
		const showHeader =
			!isCompactCommandResult &&
			(!previousMessage || previousMessage.role !== 'assistant');
		const nextIsAssistant = Boolean(nextAssistantMessage);

		return (
			<AssistantMessageGroup
				sessionId={sessionId}
				message={message}
				showHeader={showHeader}
				hasNextAssistantMessage={nextIsAssistant}
				isLastMessage={isLastMessage}
				onBranchCreated={onSelectSession}
				onNavigateToSession={onSelectSession}
				onRetry={retryHandler}
				compact={compact}
				onCompact={isLastMessage ? onCompact : undefined}
				previousUserMessage={previousUserMessage}
			/>
		);
	}

	return null;
});

interface ThreadVirtuosoContext {
	session?: Session;
	isGenerating?: boolean;
	onSelectSession?: (sessionId: string) => void;
	sessionHeaderRef: RefObject<HTMLDivElement | null>;
	footerBottomPaddingClass: string;
	showTopupApproval: boolean;
	pendingTopup: ReturnType<
		typeof useTopupApprovalStore.getState
	>['pendingTopup'];
	clearPendingTopup: () => void;
	rowOuterClass: string;
	contentWidthClass: string;
}

function ThreadVirtuosoHeader({ context }: { context: ThreadVirtuosoContext }) {
	return (
		<div ref={context.sessionHeaderRef}>
			{context.session && (
				<SessionHeader
					session={context.session}
					isGenerating={context.isGenerating}
					onNavigateToSession={context.onSelectSession}
				/>
			)}
		</div>
	);
}

function ThreadVirtuosoFooter({ context }: { context: ThreadVirtuosoContext }) {
	return (
		<div className={context.footerBottomPaddingClass}>
			{context.showTopupApproval && context.pendingTopup && (
				<div className={context.rowOuterClass}>
					<div className={context.contentWidthClass}>
						<div className="py-4">
							<TopupApprovalCard
								pendingTopup={context.pendingTopup}
								onMethodSelected={() => context.clearPendingTopup()}
								onCancel={() => context.clearPendingTopup()}
							/>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

const THREAD_VIRTUOSO_COMPONENTS: Components<Message, ThreadVirtuosoContext> = {
	Header: ThreadVirtuosoHeader,
	Footer: ThreadVirtuosoFooter,
};

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
}: MessageThreadProps) {
	const queryClient = useQueryClient();
	const { preferences } = usePreferences();
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const scrollContainerRef = useRef<HTMLElement>(null);
	const sessionHeaderRef = useRef<HTMLDivElement>(null);
	const threadRootRef = useRef<HTMLDivElement>(null);
	const threadWidth = useContainerWidth(threadRootRef);
	useThreadHandoff(sessionId, threadRootRef);
	const density: 'normal' | 'compact' =
		compact || (responsiveCompact && threadWidth > 0 && threadWidth < 640)
			? 'compact'
			: 'normal';
	const [autoScroll, setAutoScroll] = useState(true);
	const autoScrollRef = useRef(true);
	const [showLeanHeader, setShowLeanHeader] = useState(false);
	const [railInsets, setRailInsets] = useState({ top: 0, bottom: 0 });
	const userScrollingRef = useRef(false);
	const userScrollTimeoutRef = useRef<
		ReturnType<typeof setTimeout> | undefined
	>(undefined);
	const animationFrameRef = useRef<number | undefined>(undefined);
	const chromeFrameRef = useRef<number | undefined>(undefined);
	const initialScrollDoneRef = useRef(false);
	const lastSessionIdRef = useRef<string | undefined>(sessionId);
	const prevMessagesLengthRef = useRef(messages.length);
	const prevIsGeneratingRef = useRef(isGenerating);
	const lastScrollHeightRef = useRef(0);
	const lastScrollTopRef = useRef(0);

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

	useEffect(() => {
		if (!sessionId) return;
		if (
			latestTodoSnapshot ||
			messages.length <= TODO_SNAPSHOT_SCAN_MESSAGE_LIMIT
		) {
			setSessionTodos(sessionId, latestTodoSnapshot);
		}
	}, [latestTodoSnapshot, messages.length, sessionId, setSessionTodos]);

	const disableAutoFollow = useCallback(() => {
		autoScrollRef.current = false;
		userScrollingRef.current = true;
		setAutoScroll(false);
		// Kill any queued programmatic scroll frames immediately so a pending
		// multi-frame scroll burst cannot fight the user's scroll.
		if (animationFrameRef.current) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = undefined;
		}
		if (userScrollTimeoutRef.current) {
			clearTimeout(userScrollTimeoutRef.current);
		}
		userScrollTimeoutRef.current = setTimeout(() => {
			userScrollingRef.current = false;
		}, 150);
	}, []);

	// Wheel / touch give us an unambiguous "user wants to scroll up" signal that
	// is impossible to confuse with programmatic follow scrolls. The moment the
	// user scrolls up we stop following, even within the bottom band.
	const lastTouchYRef = useRef(0);
	const handleWheelIntent = useCallback(
		(event: WheelEvent) => {
			if (event.deltaY < 0) disableAutoFollow();
		},
		[disableAutoFollow],
	);
	const handleTouchStartIntent = useCallback((event: TouchEvent) => {
		lastTouchYRef.current = event.touches[0]?.clientY ?? 0;
	}, []);
	const handleTouchMoveIntent = useCallback(
		(event: TouchEvent) => {
			const y = event.touches[0]?.clientY ?? 0;
			// Finger dragging downward scrolls content up.
			if (y > lastTouchYRef.current + 2) disableAutoFollow();
			lastTouchYRef.current = y;
		},
		[disableAutoFollow],
	);

	const detachScrollIntentRef = useRef<(() => void) | undefined>(undefined);
	const attachScrollIntentListeners = useCallback(
		(element: HTMLElement | null) => {
			if (detachScrollIntentRef.current) {
				detachScrollIntentRef.current();
				detachScrollIntentRef.current = undefined;
			}
			scrollContainerRef.current = element;
			if (!element) return;
			element.addEventListener('wheel', handleWheelIntent, { passive: true });
			element.addEventListener('touchstart', handleTouchStartIntent, {
				passive: true,
			});
			element.addEventListener('touchmove', handleTouchMoveIntent, {
				passive: true,
			});
			detachScrollIntentRef.current = () => {
				element.removeEventListener('wheel', handleWheelIntent);
				element.removeEventListener('touchstart', handleTouchStartIntent);
				element.removeEventListener('touchmove', handleTouchMoveIntent);
			};
		},
		[handleWheelIntent, handleTouchStartIntent, handleTouchMoveIntent],
	);

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
		const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

		// Programmatic follow scrolls only ever move downward, so a decrease in
		// scrollTop is always user-initiated. Use a small tolerance so trackpad
		// nudges still count.
		const userScrolledUp = scrollTop < lastScrollTopRef.current - 2;

		lastScrollHeightRef.current = scrollHeight;
		lastScrollTopRef.current = scrollTop;

		if (userScrolledUp && distanceFromBottom > BOTTOM_RESUME_THRESHOLD_PX) {
			disableAutoFollow();
		} else if (distanceFromBottom <= BOTTOM_RESUME_THRESHOLD_PX) {
			// Back at the true bottom → resume following.
			autoScrollRef.current = true;
			userScrollingRef.current = false;
			setAutoScroll(true);
		}

		// The lean header + rail insets need getBoundingClientRect reads, which
		// force synchronous layout. Running them on every scroll event while
		// Virtuoso is also writing scroll offsets causes layout thrash and the
		// "bouncy" feel mid-stream. Coalesce to at most one update per frame.
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
				setShowLeanHeader(nextShowLeanHeader);
			}
			updateRailInsets(nextShowLeanHeader);
		});
	}, [disableAutoFollow, showLeanHeader, updateRailInsets]);

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

	const scrollToThreadBottom = useCallback(
		(behavior: ScrollBehavior = 'auto') => {
			virtuosoRef.current?.scrollTo({
				top: Number.MAX_SAFE_INTEGER,
				behavior,
			});
		},
		[],
	);

	const scheduleScrollToThreadBottom = useCallback(
		(behavior: ScrollBehavior = 'auto', frames = 2) => {
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
			}

			let remainingFrames = Math.max(1, frames);
			const tick = () => {
				// The user may have scrolled away between frames; stop the burst
				// instead of yanking them back to the bottom.
				if (!autoScrollRef.current) {
					animationFrameRef.current = undefined;
					return;
				}
				scrollToThreadBottom(behavior);
				remainingFrames -= 1;
				if (remainingFrames > 0) {
					animationFrameRef.current = requestAnimationFrame(tick);
					return;
				}
				animationFrameRef.current = undefined;
			};

			animationFrameRef.current = requestAnimationFrame(tick);
		},
		[scrollToThreadBottom],
	);

	// Immediate scroll to bottom on initial load or session change
	useLayoutEffect(() => {
		if (disableAutoScroll) return;

		const sessionChanged = sessionId !== lastSessionIdRef.current;
		lastSessionIdRef.current = sessionId;

		if (sessionChanged) {
			initialScrollDoneRef.current = false;
			userScrollingRef.current = false;
			lastScrollHeightRef.current = 0;
			lastScrollTopRef.current = 0;
			setShowLeanHeader(false);
			setRailInsets({ top: 0, bottom: 0 });
		}

		if (!initialScrollDoneRef.current && filteredMessages.length > 0) {
			initialScrollDoneRef.current = true;
			autoScrollRef.current = true;
			setAutoScroll(true);
			scheduleScrollToThreadBottom('auto', 6);
		}
	}, [
		filteredMessages.length,
		sessionId,
		disableAutoScroll,
		scheduleScrollToThreadBottom,
	]);

	useEffect(() => {
		if (disableAutoScroll) return;

		const justStartedGenerating = isGenerating && !prevIsGeneratingRef.current;
		const messagesAdded = messages.length > prevMessagesLengthRef.current;

		prevIsGeneratingRef.current = isGenerating;
		prevMessagesLengthRef.current = messages.length;

		// Scroll to bottom when generation starts (user just sent a message)
		if (justStartedGenerating) {
			userScrollingRef.current = false;
			autoScrollRef.current = true;
			setAutoScroll(true);
			scheduleScrollToThreadBottom('auto', 4);
		} else if (
			messagesAdded &&
			!userScrollingRef.current &&
			!isGenerating &&
			autoScrollRef.current
		) {
			// Only follow new messages if the user is still in follow mode; never
			// force-resume and yank a reader who scrolled up.
			scheduleScrollToThreadBottom('auto', 2);
		}
	}, [
		messages.length,
		isGenerating,
		disableAutoScroll,
		scheduleScrollToThreadBottom,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: messages dep needed for streaming content updates
	useLayoutEffect(() => {
		if (disableAutoScroll) return;
		// `autoScrollRef` is the single source of truth for "should follow". It is
		// flipped off the instant the user scrolls up (wheel/touch/scrollbar) and
		// back on only when they return to the true bottom, so this no longer
		// fights the user mid-stream.
		if (!autoScrollRef.current || userScrollingRef.current) return;
		scheduleScrollToThreadBottom('auto', 1);
	}, [messages, disableAutoScroll, scheduleScrollToThreadBottom]);

	useEffect(() => {
		return () => {
			if (userScrollTimeoutRef.current) {
				clearTimeout(userScrollTimeoutRef.current);
			}
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
			}
			if (chromeFrameRef.current !== undefined) {
				cancelAnimationFrame(chromeFrameRef.current);
				chromeFrameRef.current = undefined;
			}
			if (detachScrollIntentRef.current) {
				detachScrollIntentRef.current();
				detachScrollIntentRef.current = undefined;
			}
		};
	}, []);

	const scrollToBottom = () => {
		userScrollingRef.current = false;
		autoScrollRef.current = true;
		setAutoScroll(true);
		scheduleScrollToThreadBottom('auto', 3);
	};

	const handleNavigateToIndex = useCallback(
		(index: number) => {
			disableAutoFollow();
			virtuosoRef.current?.scrollToIndex({
				index,
				align: 'start',
				behavior: 'smooth',
			});
		},
		[disableAutoFollow],
	);

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
	// the right. This shifts the ENTIRE group, not just text, and works for both
	// full-width and near-full centered layouts (where auto margins can collapse
	// to ~0 and otherwise let the rail overlap the avatar). Use explicit
	// pl-*/pr-* only (never px-* + pl-*) to avoid Tailwind padding-left
	// conflicts. Compact density keeps the thin far-left dots, so it stays on the
	// tight px-2 spacing.
	const rowOuterClass =
		density === 'compact'
			? 'px-2 pb-3'
			: compact
				? 'pl-14 pr-14 pb-4'
				: 'pl-14 pr-14 pb-6';
	const firstRowTopClass =
		density === 'compact' ? 'pt-3' : compact ? 'pt-4' : 'pt-6';
	const footerBottomPaddingClass =
		footerBottomPaddingClassOverride ??
		(density === 'compact' || compact ? 'pb-80' : 'pb-96');
	const virtuosoContext = useMemo<ThreadVirtuosoContext>(
		() => ({
			session,
			isGenerating,
			onSelectSession,
			sessionHeaderRef,
			footerBottomPaddingClass,
			showTopupApproval: Boolean(showTopupApproval),
			pendingTopup,
			clearPendingTopup,
			rowOuterClass,
			contentWidthClass,
		}),
		[
			session,
			isGenerating,
			onSelectSession,
			footerBottomPaddingClass,
			showTopupApproval,
			pendingTopup,
			clearPendingTopup,
			rowOuterClass,
			contentWidthClass,
		],
	);

	// Create a retry handler for error messages
	const createRetryHandler = useCallback(
		(messageId: string) => {
			return async () => {
				if (!sessionId) return;
				if (!messageId) return;

				queryClient.setQueryData<Message[]>(
					getMessagesQueryKey(sessionId),
					(oldMessages) => {
						if (!oldMessages) return oldMessages;
						return oldMessages.map((msg) => {
							if (msg.id !== messageId) return msg;
							const partsToKeep =
								msg.parts?.filter(
									(part: { type: string; toolName?: string }) => {
										if (part.type === 'error') return false;
										if (part.type === 'tool_call' && part.toolName === 'finish')
											return false;
										return true;
									},
								) ?? [];
							return {
								...msg,
								status: 'pending',
								parts: partsToKeep,
								error: null,
							};
						});
					},
				);

				try {
					await apiClient.retryMessage(sessionId, messageId);
				} catch (error) {
					toast.error(
						error instanceof Error ? error.message : 'Failed to retry',
					);
				}
			};
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

	if (messages.length === 0) {
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

				<Virtuoso
					ref={virtuosoRef}
					className="flex-1 scrollbar-hide"
					data={filteredMessages}
					atBottomThreshold={100}
					increaseViewportBy={{ top: 2400, bottom: 1600 }}
					minOverscanItemCount={{ top: 4, bottom: 3 }}
					initialTopMostItemIndex={{
						index: Math.max(0, filteredMessages.length - 1),
						align: 'end',
					}}
					followOutput={(isAtBottom) =>
						autoScrollRef.current && isAtBottom ? 'auto' : false
					}
					scrollerRef={(ref) => {
						attachScrollIntentListeners(
							ref instanceof HTMLElement ? ref : null,
						);
					}}
					onScroll={handleScroll}
					computeItemKey={(_, message) => message.id}
					components={THREAD_VIRTUOSO_COMPONENTS}
					context={virtuosoContext}
					itemContent={(idx, message) => (
						<div
							className={`${rowOuterClass} ${idx === 0 ? firstRowTopClass : ''}`}
						>
							<div
								data-smart-edge-ignore="left"
								data-smart-edge-ignore-mode="content"
								className={contentWidthClass}
							>
								<ThreadMessageRow
									sessionId={sessionId}
									message={message}
									previousMessage={filteredMessages[idx - 1]}
									nextMessage={filteredMessages[idx + 1]}
									isFirst={idx === 0}
									isLastMessage={idx === filteredMessages.length - 1}
									currentMessageId={queueState.currentMessageId}
									queueLength={queueState.queueLength}
									compact={compact}
									onSelectSession={onSelectSession}
									createRetryHandler={createRetryHandler}
									onCompact={handleCompact}
								/>
							</div>
						</div>
					)}
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
				{!autoScroll && (
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
