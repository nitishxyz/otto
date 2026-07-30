import { memo, useMemo, useState } from 'react';
import {
	ChevronDown,
	ChevronUp,
	Clock,
	ListOrdered,
	RotateCcw,
	Send,
	Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getMessagesQueryKey, useMessages } from '../../hooks/useMessages';
import {
	getQueueStateQueryKey,
	useQueueState,
} from '../../hooks/useQueueState';
import { apiClient } from '../../lib/api-client';
import { getMessageChatDraftAttachments } from '../../lib/chatAttachments';
import { useQueueStore } from '../../stores/queueStore';
import type { Message } from '../../types/api';

interface InputQueueBarProps {
	sessionId: string;
}

interface QueuedMessagePreview {
	assistantMessageId: string;
	position: number;
	text: string;
	attachments: ReturnType<typeof getMessageChatDraftAttachments>;
}

function getMessageText(message: Message | undefined) {
	const textPart = message?.parts?.find((part) => part.type === 'text');
	if (!textPart) return 'Queued message';
	const data = textPart.contentJson || textPart.content;
	if (data && typeof data === 'object' && 'text' in data) {
		const text = String(data.text).trim();
		return text || 'Queued message';
	}
	if (typeof data === 'string') {
		const text = data.trim();
		return text || 'Queued message';
	}
	return 'Queued message';
}

function getQueuedPreviews(
	messages: Message[],
	queuedMessages: Array<{ messageId: string; position: number }>,
) {
	const sortedMessages = [...messages].sort(
		(a, b) => a.createdAt - b.createdAt,
	);
	const queueItems = [...queuedMessages].sort(
		(a, b) => a.position - b.position,
	);

	return queueItems.map((queued): QueuedMessagePreview => {
		const assistantIndex = sortedMessages.findIndex(
			(message) => message.id === queued.messageId,
		);
		const userMessage =
			assistantIndex > 0 ? sortedMessages[assistantIndex - 1] : undefined;

		return {
			assistantMessageId: queued.messageId,
			position: queued.position,
			text: getMessageText(userMessage),
			attachments: getMessageChatDraftAttachments(userMessage),
		};
	});
}

function QueueRow({
	item,
	onSendNow,
	onCancel,
	onDelete,
}: {
	item: QueuedMessagePreview;
	onSendNow: (item: QueuedMessagePreview) => void;
	onCancel: (item: QueuedMessagePreview) => void;
	onDelete: (item: QueuedMessagePreview) => void;
}) {
	return (
		<div className="flex items-center gap-2 min-w-0 px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-200">
			<span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
				{item.position + 1}
			</span>
			<span className="text-xs text-foreground truncate flex-1">
				{item.text}
			</span>
			<div className="flex items-center gap-1 flex-shrink-0">
				<button
					type="button"
					onClick={() => onSendNow(item)}
					className="flex h-7 w-7 items-center justify-center rounded bg-transparent text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
					title="Send now"
				>
					<Send className="h-3.5 w-3.5" />
				</button>
				<button
					type="button"
					onClick={() => onCancel(item)}
					className="flex h-7 w-7 items-center justify-center rounded bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					title="Cancel and restore to input"
				>
					<RotateCcw className="h-3.5 w-3.5" />
				</button>
				<button
					type="button"
					onClick={() => onDelete(item)}
					className="flex h-7 w-7 items-center justify-center rounded bg-transparent text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
					title="Delete from queue"
				>
					<Trash2 className="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	);
}

export const InputQueueBar = memo(function InputQueueBar({
	sessionId,
}: InputQueueBarProps) {
	const queryClient = useQueryClient();
	const { data: messages = [] } = useMessages(sessionId, {
		staleTime: Infinity,
	});
	const queueState = useQueueState(sessionId);
	const setPendingRestore = useQueueStore((state) => state.setPendingRestore);
	const [isExpanded, setIsExpanded] = useState(false);
	const queuedItems = useMemo(
		() => getQueuedPreviews(messages, queueState.queuedMessages),
		[messages, queueState.queuedMessages],
	);
	const hasQueuedMessages = queuedItems.length > 0;
	const firstQueued = queuedItems[0];
	const canExpand = hasQueuedMessages;

	const removeQueuedItem = async (
		item: QueuedMessagePreview,
		restoreToInput: boolean,
	) => {
		if (restoreToInput) {
			setPendingRestore({
				sessionId,
				text: item.text,
				attachments: item.attachments,
			});
		}
		try {
			await apiClient.removeFromQueue(sessionId, item.assistantMessageId);
			queryClient.invalidateQueries({
				queryKey: getMessagesQueryKey(sessionId),
			});
			queryClient.invalidateQueries({
				queryKey: getQueueStateQueryKey(sessionId),
			});
		} catch (error) {
			console.error('Failed to remove queued message:', error);
		}
	};

	const sendQueuedItemNow = async (item: QueuedMessagePreview) => {
		try {
			await apiClient.sendQueuedMessageNow(sessionId, item.assistantMessageId);
			queryClient.invalidateQueries({
				queryKey: getMessagesQueryKey(sessionId),
			});
			queryClient.invalidateQueries({
				queryKey: getQueueStateQueryKey(sessionId),
			});
		} catch (error) {
			console.error('Failed to send queued message now:', error);
		}
	};

	return (
		<div
			className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
			style={{
				gridTemplateRows: hasQueuedMessages ? '1fr' : '0fr',
				opacity: hasQueuedMessages ? 1 : 0,
			}}
		>
			<div className="overflow-hidden">
				<div className="border border-border bg-card rounded-xl overflow-hidden mb-1">
					<div
						className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
						style={{
							gridTemplateRows: isExpanded ? '0fr' : '1fr',
							opacity: isExpanded ? 0 : 1,
						}}
					>
						<div className="overflow-hidden">
							<button
								type="button"
								aria-expanded={isExpanded}
								aria-label={
									canExpand ? 'Expand queued messages' : 'Queued messages'
								}
								disabled={!canExpand}
								onClick={() => canExpand && setIsExpanded(true)}
								className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
									canExpand ? 'hover:bg-muted cursor-pointer' : 'cursor-default'
								}`}
							>
								<Clock className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
								<span className="text-xs font-medium text-foreground flex-shrink-0">
									Queued
								</span>
								{firstQueued && (
									<>
										<span className="h-3 w-px bg-border flex-shrink-0" />
										<span
											key={`${firstQueued.assistantMessageId}-${firstQueued.text}`}
											className="text-xs text-foreground truncate flex-1 animate-in fade-in slide-in-from-top-1 duration-200"
										>
											{firstQueued.text}
										</span>
									</>
								)}
								<span className="text-[11px] text-muted-foreground ml-auto flex-shrink-0">
									{queuedItems.length} queued
								</span>
								{canExpand && (
									<ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
								)}
							</button>
						</div>
					</div>

					<div
						className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
						style={{
							gridTemplateRows: isExpanded ? '1fr' : '0fr',
							opacity: isExpanded ? 1 : 0,
						}}
					>
						<div className="overflow-hidden">
							<button
								type="button"
								aria-expanded={isExpanded}
								aria-label="Collapse queued messages"
								onClick={() => setIsExpanded(false)}
								className="flex w-full items-center gap-2 px-3 py-2 border-b border-border text-left transition-colors hover:bg-muted"
							>
								<ListOrdered className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
								<span className="text-xs font-medium text-foreground">
									Queued messages
								</span>
								<span className="text-[11px] text-muted-foreground ml-auto">
									{queuedItems.length} waiting
								</span>
								<ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
							</button>
							<div className="divide-y divide-border">
								{queuedItems.map((item) => (
									<QueueRow
										key={item.assistantMessageId}
										item={item}
										onSendNow={sendQueuedItemNow}
										onCancel={(queuedItem) =>
											removeQueuedItem(queuedItem, true)
										}
										onDelete={(queuedItem) =>
											removeQueuedItem(queuedItem, false)
										}
									/>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
});
