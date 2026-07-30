import { memo, useMemo, type ReactNode } from 'react';
import { MessageItem } from './MessageItem.tsx';
import { OttoWordmark } from './OttoWordmark.tsx';
import { useTheme } from '../theme.ts';
import type { Message, PendingApproval } from '../types.ts';

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
	emptyStateInputWidth?: '80%' | '100%';
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
	emptyStateInputWidth = '80%',
}: ChatViewProps) {
	const { colors } = useTheme();

	const sorted = useMemo(() => {
		return messages
			.filter((m) => m.role === 'user' || m.role === 'assistant')
			.sort((a, b) => a.createdAt - b.createdAt);
	}, [messages]);

	const queuedUserIds = useMemo(() => {
		const ids = new Set<string>();
		for (let i = 0; i < sorted.length; i++) {
			const msg = sorted[i];
			if (msg.role === 'user') {
				const next = sorted[i + 1];
				if (
					next &&
					next.role === 'assistant' &&
					queuedMessageIds.has(next.id)
				) {
					ids.add(msg.id);
				}
			}
		}
		return ids;
	}, [sorted, queuedMessageIds]);

	const visibleMessages = useMemo(() => {
		return sorted.filter((m) => {
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
	}, [sorted, streamingMessageId]);

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
				<box style={{ flexDirection: 'row', gap: 3 }}>
					<text fg={colors.fgDimmed}>
						<span fg={colors.fgDark}>/help</span> commands
					</text>
					<text fg={colors.fgDimmed}>
						<span fg={colors.fgDark}>Ctrl+S</span> sessions
					</text>
					<text fg={colors.fgDimmed}>
						<span fg={colors.fgDark}>Ctrl+P</span> models
					</text>
					<text fg={colors.fgDimmed}>
						<span fg={colors.fgDark}>Ctrl+B</span> activity
					</text>
					<text fg={colors.fgDimmed}>
						<span fg={colors.fgDark}>Tab</span> plan mode
					</text>
				</box>
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
		<scrollbox
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
		>
			{visibleMessages.map((msg, i) => {
				const previousMessage = visibleMessages[i - 1];
				const showHeader =
					msg.role !== 'assistant' || previousMessage?.role !== 'assistant';
				return (
					<MessageItem
						key={msg.id}
						message={msg}
						isStreaming={msg.id === streamingMessageId}
						isQueued={queuedUserIds.has(msg.id)}
						showHeader={showHeader}
						isFirstMessage={i === 0}
						pendingApprovals={approvalsByMessage.get(msg.id) ?? EMPTY_APPROVALS}
						onApprove={onApprove}
						onDeny={onDeny}
						recipeNames={recipeNames}
					/>
				);
			})}
		</scrollbox>
	);
});

const EMPTY_APPROVALS: PendingApproval[] = [];
const EMPTY_RECIPE_NAMES = new Set<string>();
