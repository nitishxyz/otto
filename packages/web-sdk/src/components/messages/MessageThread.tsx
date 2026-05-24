import { useEffect, useRef, useState, useMemo, memo, useCallback } from 'react';
import { ArrowDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
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
}

const TODO_TOOL_NAMES = new Set([
	'update_todos',
	'update_plan',
	'UpdateTodos',
	'UpdatePlan',
]);

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
	const rawResult = content.result;
	const result =
		rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
			? (rawResult as Record<string, unknown>)
			: content;
	const rawItems = result.items;
	if (!Array.isArray(rawItems)) return null;

	const items = rawItems.flatMap((item): TodoItem[] => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			return [];
		}
		const record = item as Record<string, unknown>;
		if (typeof record.step !== 'string' || !isTodoStatus(record.status)) {
			return [];
		}
		return [{ step: record.step, status: record.status }];
	});
	const note = typeof result.note === 'string' ? result.note : undefined;

	return { items, note };
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
		for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
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

export const MessageThread = memo(function MessageThread({
	messages,
	session,
	sessionId,
	isGenerating,
	compact = false,
	disableAutoScroll = false,
	onSelectSession,
}: MessageThreadProps) {
	const queryClient = useQueryClient();
	const { preferences } = usePreferences();
	const bottomRef = useRef<HTMLDivElement>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const sessionHeaderRef = useRef<HTMLDivElement>(null);
	const threadRootRef = useRef<HTMLDivElement>(null);
	const threadWidth = useContainerWidth(threadRootRef);
	const density: 'normal' | 'compact' =
		threadWidth > 0 && threadWidth < 640 ? 'compact' : 'normal';
	const [autoScroll, setAutoScroll] = useState(true);
	const autoScrollRef = useRef(true);
	const [showLeanHeader, setShowLeanHeader] = useState(false);
	const userScrollingRef = useRef(false);
	const userScrollTimeoutRef = useRef<
		ReturnType<typeof setTimeout> | undefined
	>(undefined);
	const targetScrollRef = useRef(0);
	const animationFrameRef = useRef<number | undefined>(undefined);
	const initialScrollDoneRef = useRef(false);
	const lastSessionIdRef = useRef<string | undefined>(session?.id);
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

	useEffect(() => {
		if (!sessionId) return;
		setSessionTodos(
			sessionId,
			findLatestTodoSnapshot(messages, queuedMessageIds),
		);
	}, [messages, queuedMessageIds, sessionId, setSessionTodos]);

	const handleScroll = useCallback(() => {
		const container = scrollContainerRef.current;
		if (!container) return;

		const { scrollTop, scrollHeight, clientHeight } = container;
		const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

		const scrollHeightIncreased = scrollHeight > lastScrollHeightRef.current;
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
		} else if (!scrollHeightIncreased && autoScrollRef.current) {
			autoScrollRef.current = false;
			setAutoScroll(false);
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

	// Immediate scroll to bottom on initial load or session change
	useEffect(() => {
		if (disableAutoScroll) return;

		const sessionChanged = session?.id !== lastSessionIdRef.current;
		lastSessionIdRef.current = session?.id;

		if (sessionChanged) {
			initialScrollDoneRef.current = false;
		}

		if (!initialScrollDoneRef.current && messages.length > 0) {
			initialScrollDoneRef.current = true;
			const container = scrollContainerRef.current;
			if (container) {
				container.scrollTop = container.scrollHeight;
			}
		}
	}, [messages.length, session?.id, disableAutoScroll]);

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
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					const container = scrollContainerRef.current;
					if (container) {
						container.scrollTop = container.scrollHeight;
					}
				});
			});
		} else if (messagesAdded && !userScrollingRef.current && !isGenerating) {
			autoScrollRef.current = true;
			setAutoScroll(true);
		}
	}, [messages.length, isGenerating, disableAutoScroll]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: messages dep needed for streaming content updates
	useEffect(() => {
		if (disableAutoScroll) return;

		const container = scrollContainerRef.current;
		if (!container || !autoScroll || userScrollingRef.current) return;

		targetScrollRef.current = container.scrollHeight - container.clientHeight;

		const animate = () => {
			const el = scrollContainerRef.current;
			if (!el || userScrollingRef.current) return;

			const current = el.scrollTop;
			const target = el.scrollHeight - el.clientHeight;
			const diff = target - current;

			if (Math.abs(diff) < 1) {
				el.scrollTop = el.scrollHeight - el.clientHeight;
				return;
			}

			// If very close, just snap to bottom
			if (Math.abs(diff) < 10) {
				el.scrollTop = el.scrollHeight - el.clientHeight;
				return;
			}

			el.scrollTop = current + diff * 0.15;
			animationFrameRef.current = requestAnimationFrame(animate);
		};

		if (animationFrameRef.current) {
			cancelAnimationFrame(animationFrameRef.current);
		}
		animationFrameRef.current = requestAnimationFrame(animate);
	}, [messages, autoScroll]);

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
		const container = scrollContainerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	};

	const filteredMessages = useMemo(() => {
		const visibleMessages = messages.filter(
			(message) =>
				message.role !== 'system' &&
				!(
					message.role === 'assistant' &&
					message.status === 'complete' &&
					(message.parts?.length ?? 0) === 0
				),
		);
		const queueBusy =
			Boolean(queueState.currentMessageId) || queueState.queueLength > 0;

		if (!queueBusy) return visibleMessages;

		return visibleMessages.filter((message, index) => {
			if (message.role === 'assistant') {
				const isPendingEmptyAssistant =
					message.status === 'pending' &&
					(message.parts?.length ?? 0) === 0 &&
					message.id !== queueState.currentMessageId;
				return !isPendingEmptyAssistant;
			}

			if (message.role !== 'user') return true;

			const nextAssistant = visibleMessages
				.slice(index + 1)
				.find((candidate) => candidate.role === 'assistant');
			if (nextAssistant) {
				const nextAssistantIsQueued =
					queuedMessageIds.has(nextAssistant.id) ||
					(nextAssistant.status === 'pending' &&
						(nextAssistant.parts?.length ?? 0) === 0 &&
						nextAssistant.id !== queueState.currentMessageId);
				return !nextAssistantIsQueued;
			}

			const hasEarlierActiveAssistant = visibleMessages
				.slice(0, index)
				.some(
					(candidate) =>
						candidate.role === 'assistant' &&
						(candidate.id === queueState.currentMessageId ||
							(candidate.status === 'pending' &&
								!queuedMessageIds.has(candidate.id))),
				);
			return !hasEarlierActiveAssistant;
		});
	}, [
		messages,
		queueState.currentMessageId,
		queueState.queueLength,
		queuedMessageIds,
	]);

	const contentWidthClass = preferences.fullWidthContent
		? compact
			? 'w-full space-y-4'
			: 'w-full space-y-6'
		: compact
			? 'max-w-3xl mx-auto space-y-4'
			: 'max-w-3xl mx-auto space-y-6';

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

				<div
					ref={scrollContainerRef}
					className="flex-1 overflow-y-auto scrollbar-hide"
					onScroll={handleScroll}
				>
					{/* Session Header - scrolls with content */}
					<div ref={sessionHeaderRef}>
						{session && (
							<SessionHeader
								session={session}
								onNavigateToSession={onSelectSession}
							/>
						)}
					</div>

					{/* Messages */}
					<div
						className={
							density === 'compact'
								? 'px-2 pt-3 pb-80'
								: compact
									? 'p-4 pb-80'
									: 'p-6 pb-96'
						}
					>
						<div className={contentWidthClass}>
							{filteredMessages.map((message, idx) => {
								const prevMessage = filteredMessages[idx - 1];
								const nextMessage = filteredMessages[idx + 1];
								const isLastMessage = idx === filteredMessages.length - 1;

								if (message.role === 'user') {
									const nextAssistantMessage =
										nextMessage && nextMessage.role === 'assistant'
											? nextMessage
											: undefined;
									return (
										<UserMessageGroup
											key={message.id}
											sessionId={sessionId}
											message={message}
											isFirst={idx === 0}
											nextAssistantMessageId={nextAssistantMessage?.id}
										/>
									);
								}

								if (message.role === 'assistant') {
									const showHeader =
										!prevMessage || prevMessage.role !== 'assistant';
									const nextIsAssistant =
										nextMessage && nextMessage.role === 'assistant';
									const hasQueuedOrRunningLaterTurn = Boolean(
										queueState.currentMessageId &&
											queueState.currentMessageId !== message.id,
									);
									const canRetryTurn =
										isLastMessage &&
										!hasQueuedOrRunningLaterTurn &&
										queueState.queueLength === 0;

									return (
										<AssistantMessageGroup
											key={message.id}
											sessionId={sessionId}
											message={message}
											showHeader={showHeader}
											hasNextAssistantMessage={nextIsAssistant}
											isLastMessage={isLastMessage}
											onBranchCreated={onSelectSession}
											onNavigateToSession={onSelectSession}
											onRetry={
												canRetryTurn
													? createRetryHandler(message.id)
													: undefined
											}
											compact={compact}
											onCompact={isLastMessage ? handleCompact : undefined}
										/>
									);
								}

								return null;
							})}

							{/* Topup Approval Card - shown when payment required */}
							{showTopupApproval && pendingTopup && (
								<div className="py-4">
									<TopupApprovalCard
										pendingTopup={pendingTopup}
										onMethodSelected={() => clearPendingTopup()}
										onCancel={() => clearPendingTopup()}
									/>
								</div>
							)}

							<div ref={bottomRef} />
						</div>
					</div>
				</div>

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
