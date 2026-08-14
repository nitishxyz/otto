import {
	memo,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	type ReactNode,
} from 'react';
import type { ScrollBoxRenderable } from '@opentui/core';
import { MessageItem } from './MessageItem.tsx';
import { OttoWordmark } from './OttoWordmark.tsx';
import { useTheme } from '../theme.ts';
import type { Message, PendingApproval } from '../types.ts';
import { getQueuedMessageItems } from '../lib/queue.ts';

interface ChatViewProps {
	messages: Message[];
	isStreaming: boolean;
	streamingMessageId: string | null;
	queuedMessageIds: Set<string>;
	pendingApprovals: PendingApproval[];
	onApprove: (callId: string) => void;
	onDeny: (callId: string) => void;
	recipeNames?: ReadonlySet<string>;
	emptyStateInput?: ReactNode;
	emptyStateInputWidth?: '64%' | '100%';
	hasOlderMessages?: boolean;
	isLoadingOlderMessages?: boolean;
	onLoadOlderMessages?: () => Promise<boolean>;
	retryMessageId?: string | null;
}

export const ChatView = memo(function ChatView({
	messages,
	isStreaming: _isStreaming,
	streamingMessageId,
	queuedMessageIds,
	pendingApprovals,
	onApprove,
	onDeny,
	recipeNames = EMPTY_RECIPE_NAMES,
	emptyStateInput,
	emptyStateInputWidth = '64%',
	hasOlderMessages = false,
	isLoadingOlderMessages = false,
	onLoadOlderMessages,
	retryMessageId,
}: ChatViewProps) {
	const { colors } = useTheme();
	const scrollRef = useRef<ScrollBoxRenderable | null>(null);
	const prependHeightRef = useRef<number | null>(null);
	const loadedOldestMessageIdRef = useRef(messages[0]?.id);

	const loadOlderMessages = useCallback(() => {
		const scrollbox = scrollRef.current;
		if (
			!scrollbox ||
			scrollbox.scrollTop > 0 ||
			!hasOlderMessages ||
			isLoadingOlderMessages ||
			!onLoadOlderMessages
		) {
			return;
		}
		prependHeightRef.current = scrollbox.scrollHeight;
		loadedOldestMessageIdRef.current = messages[0]?.id;
		void onLoadOlderMessages().then((loaded) => {
			if (!loaded) prependHeightRef.current = null;
		});
	}, [hasOlderMessages, isLoadingOlderMessages, messages, onLoadOlderMessages]);

	useLayoutEffect(() => {
		const previousHeight = prependHeightRef.current;
		const scrollbox = scrollRef.current;
		if (
			previousHeight === null ||
			!scrollbox ||
			messages[0]?.id === loadedOldestMessageIdRef.current
		) {
			return;
		}
		scrollbox.scrollTop = Math.max(0, scrollbox.scrollHeight - previousHeight);
		prependHeightRef.current = null;
	}, [messages]);

	const sorted = useMemo(() => {
		return messages
			.filter((m) => m.role === 'user' || m.role === 'assistant')
			.sort((a, b) => a.createdAt - b.createdAt);
	}, [messages]);

	const queuedUserIds = useMemo(() => {
		return new Set(
			getQueuedMessageItems(sorted, queuedMessageIds).map(
				(item) => item.userMessageId,
			),
		);
	}, [sorted, queuedMessageIds]);

	const visibleMessages = useMemo(() => {
		return sorted.filter((m) => {
			if (queuedMessageIds.has(m.id) || queuedUserIds.has(m.id)) return false;
			if (
				m.role === 'assistant' &&
				m.status === 'pending' &&
				(!m.parts || m.parts.length === 0) &&
				m.id !== streamingMessageId
			) {
				return false;
			}
			return true;
		});
	}, [sorted, streamingMessageId, queuedMessageIds, queuedUserIds]);

	const approvalsByMessage = useMemo(() => {
		const map = new Map<string, PendingApproval[]>();
		for (const a of pendingApprovals) {
			const existing = map.get(a.messageId);
			if (existing) {
				existing.push(a);
			} else {
				map.set(a.messageId, [a]);
			}
		}
		return map;
	}, [pendingApprovals]);

	if (visibleMessages.length === 0) {
		return (
			<box
				style={{
					width: '100%',
					flexGrow: 1,
					justifyContent: 'center',
					alignItems: 'center',
					flexDirection: 'column',
					gap: 1,
				}}
			>
				<OttoWordmark />
				<text fg={colors.fgDark}>Type a message to start a conversation</text>
				{emptyStateInput && (
					<box
						style={{
							width: emptyStateInputWidth,
							flexDirection: 'column',
						}}
					>
						{emptyStateInput}
					</box>
				)}
			</box>
		);
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI scrollboxes handle terminal mouse and key scrolling
		<scrollbox
			ref={scrollRef}
			style={{
				width: '100%',
				flexGrow: 1,
				paddingLeft: 0,
				paddingRight: 0,
				paddingTop: 0,
				paddingBottom: 1,
			}}
			stickyScroll
			stickyStart="bottom"
			onMouseScroll={(event) => {
				if (event.scroll?.direction === 'up') loadOlderMessages();
			}}
			onKeyDown={(key) => {
				if (key.name === 'pageup' || key.name === 'home') loadOlderMessages();
			}}
		>
			{hasOlderMessages || isLoadingOlderMessages ? (
				<text fg={colors.fgDimmed}>
					{isLoadingOlderMessages
						? 'Loading older messages…'
						: 'Scroll up for older messages'}
				</text>
			) : null}
			{visibleMessages.map((msg, i) => {
				const previousMessage = visibleMessages[i - 1];
				const showHeader =
					msg.role !== 'assistant' || previousMessage?.role !== 'assistant';
				return (
					<MessageItem
						key={msg.id}
						message={msg}
						isStreaming={msg.id === streamingMessageId}
						showHeader={showHeader}
						isFirstMessage={i === 0}
						pendingApprovals={approvalsByMessage.get(msg.id) ?? EMPTY_APPROVALS}
						onApprove={onApprove}
						onDeny={onDeny}
						recipeNames={recipeNames}
						canRetry={msg.id === retryMessageId}
					/>
				);
			})}
		</scrollbox>
	);
});

const EMPTY_APPROVALS: PendingApproval[] = [];
const EMPTY_RECIPE_NAMES = new Set<string>();
