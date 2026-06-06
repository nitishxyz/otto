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
import { SessionHeader } from '../sessions/SessionHeader';
import { LeanHeader } from '../sessions/LeanHeader';
import { TopupApprovalCard } from './TopupApprovalCard';
import { usePreferences } from '../../hooks/usePreferences';
import { useQueueState } from '../../hooks/useQueueState';
import { useTopupApprovalStore } from '../../stores/topupApprovalStore';
import {
	useTodoStore,
	type TodoItem,
	type TodoSnapshot,
} from '../../stores/todoStore';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import { ThreadDensityProvider } from './threadDensity';
import { apiClient } from '../../lib/api-client';
import { toast } from '../../stores/toastStore';

interface MessageThreadProps {
	messages: Message[];
	session?: Session;
	sessionId?: string;
	isGenerating?: boolean;
	compact?: boolean;
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
	isThreadScrolling: boolean;
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
	isThreadScrolling,
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
		const showHeader = !previousMessage || previousMessage.role !== 'assistant';
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
				isThreadScrolling={isThreadScrolling}
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
	const density: 'normal' | 'compact' =
		threadWidth > 0 && threadWidth < 640 ? 'compact' : 'normal';
	const [autoScroll, setAutoScroll] = useState(true);
	const [isThreadScrolling, setIsThreadScrolling] = useState(false);
	const autoScrollRef = useRef(true);
	const [showLeanHeader, setShowLeanHeader] = useState(false);
	const userScrollingRef = useRef(false);
	const userScrollTimeoutRef = useRef<
		ReturnType<typeof setTimeout> | undefined
	>(undefined);
	const animationFrameRef = useRef<number | undefined>(undefined);
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

	const handleScroll = useCallback(() => {
		const container = scrollContainerRef.current;
		if (!container) return;

		const { scrollTop, scrollHeight, clientHeight } = container;
		const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

		const userScrolledUp = scrollTop < lastScrollTopRef.current - 5;

		lastScrollHeightRef.current = scrollHeight;
		lastScrollTopRef.current = scrollTop;

		if (distanceFromBottom < 100) {
			autoScrollRef.current = true;
			setAutoScroll(true);
		} else if (userScrolledUp) {
			autoScrollRef.current = false;
			setAutoScroll(false);
			userScrollingRef.current = true;
		}
		if (
			userScrolledUp ||
			(!autoScrollRef.current && distanceFromBottom >= 100)
		) {
			if (userScrollTimeoutRef.current) {
				clearTimeout(userScrollTimeoutRef.current);
			}
			userScrollTimeoutRef.current = setTimeout(() => {
				userScrollingRef.current = false;
			}, 150);
		}

		const headerElement = sessionHeaderRef.current;
		if (headerElement) {
			const headerRect = headerElement.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			setShowLeanHeader(headerRect.bottom < containerRect.top);
		}
	}, []);

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
			setIsThreadScrolling(false);
			lastScrollHeightRef.current = 0;
			lastScrollTopRef.current = 0;
			setShowLeanHeader(false);
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
		} else if (messagesAdded && !userScrollingRef.current && !isGenerating) {
			autoScrollRef.current = true;
			setAutoScroll(true);
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
		};
	}, []);

	const scrollToBottom = () => {
		userScrollingRef.current = false;
		autoScrollRef.current = true;
		setAutoScroll(true);
		scheduleScrollToThreadBottom('auto', 3);
	};

	const contentWidthClass = preferences.fullWidthContent
		? compact
			? 'w-full space-y-4'
			: 'w-full space-y-6'
		: compact
			? 'max-w-3xl mx-auto space-y-4'
			: 'max-w-3xl mx-auto space-y-6';
	const rowOuterClass =
		density === 'compact' ? 'px-2 pb-3' : compact ? 'px-4 pb-4' : 'px-6 pb-6';
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
					['messages', sessionId],
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
						scrollContainerRef.current =
							ref instanceof HTMLElement ? ref : null;
					}}
					onScroll={handleScroll}
					isScrolling={setIsThreadScrolling}
					computeItemKey={(_, message) => message.id}
					components={THREAD_VIRTUOSO_COMPONENTS}
					context={virtuosoContext}
					itemContent={(idx, message) => (
						<div
							className={`${rowOuterClass} ${idx === 0 ? firstRowTopClass : ''}`}
						>
							<div className={contentWidthClass}>
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
									isThreadScrolling={isThreadScrolling}
									onSelectSession={onSelectSession}
									createRetryHandler={createRetryHandler}
									onCompact={handleCompact}
								/>
							</div>
						</div>
					)}
				/>

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
