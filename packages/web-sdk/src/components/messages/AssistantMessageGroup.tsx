import { memo, useState, useCallback, useMemo } from 'react';
import {
	Sparkles,
	GitBranch,
	Copy,
	Check,
	Shield,
	CheckCheck,
} from 'lucide-react';
import type { Message, MessagePart } from '../../types/api';
import { MessagePartItem } from './MessagePartItem';
import { CompactActivityGroup } from './CompactActivityGroup';
import { ActionToolBox } from './ActionToolBox';
import { useMessageQueuePosition } from '../../hooks/useQueueState';
import { BranchModal } from '../branch/BranchModal';
import { ProviderLogo } from '../common/ProviderLogo';
import { StableSpinner } from '../ui/StableSpinner';
import { useToolApprovalStore } from '../../stores/toolApprovalStore';
import { apiClient } from '../../lib/api-client';
import {
	type CompactActivityEntry,
	buildCompactActivityEntries,
	isCompactActivityPart,
} from './compactActivity';
import { useIsCompactThread } from './threadDensity';

interface AssistantMessageGroupProps {
	sessionId?: string;
	message: Message;
	showHeader: boolean;
	hasNextAssistantMessage: boolean;
	isLastMessage: boolean;
	onBranchCreated?: (newSessionId: string) => void;
	compact?: boolean;
	showBranchButton?: boolean;
	onNavigateToSession?: (sessionId: string) => void;
	onRetry?: () => void;
	onCompact?: () => void;
}

const loadingMessages = [
	'Generating...',
	'Cooking up something...',
	'Thinking...',
	'Processing...',
	'Working on it...',
	'Crafting response...',
	'Brewing magic...',
	'Computing...',
];

function getLoadingMessage(messageId: string) {
	const hash = messageId
		.split('')
		.reduce((acc, char) => acc + char.charCodeAt(0), 0);
	return loadingMessages[hash % loadingMessages.length];
}

type AssistantRenderItem =
	| {
			kind: 'part';
			index: number;
			part: MessagePart;
	  }
	| {
			kind: 'group';
			id: string;
			entries: CompactActivityEntry[];
			titleOverride?: string;
	  };

export const AssistantMessageGroup = memo(
	function AssistantMessageGroup({
		sessionId,
		message,
		showHeader,
		hasNextAssistantMessage,
		onBranchCreated,
		compact,
		showBranchButton = true,
		onNavigateToSession,
		onRetry,
		onCompact,
	}: AssistantMessageGroupProps) {
		const { isQueued } = useMessageQueuePosition(sessionId, message.id);
		const isCompactDensity = useIsCompactThread();
		const isCompactThread = Boolean(compact || isCompactDensity);
		const [isHovered, setIsHovered] = useState(false);
		const [showBranchModal, setShowBranchModal] = useState(false);
		const [copied, setCopied] = useState(false);

		// Tool approval handling
		const { pendingApprovals, removePendingApproval } = useToolApprovalStore();

		const handleApprove = useCallback(
			async (callId: string) => {
				if (!sessionId) return;
				try {
					await apiClient.approveToolCall(sessionId, callId, true);
					removePendingApproval(callId);
				} catch (error) {
					console.error('Failed to approve tool call:', error);
				}
			},
			[sessionId, removePendingApproval],
		);

		const handleReject = useCallback(
			async (callId: string) => {
				if (!sessionId) return;
				try {
					await apiClient.approveToolCall(sessionId, callId, false);
					removePendingApproval(callId);
				} catch (error) {
					console.error('Failed to reject tool call:', error);
				}
			},
			[sessionId, removePendingApproval],
		);

		// Handle approving all pending approvals for this message
		const messagePendingApprovals = useMemo(() => {
			return pendingApprovals.filter((a) => a.messageId === message.id);
		}, [pendingApprovals, message.id]);

		const handleApproveAll = useCallback(async () => {
			if (!sessionId) return;
			try {
				await Promise.all(
					messagePendingApprovals.map((a) =>
						apiClient.approveToolCall(sessionId, a.callId, true),
					),
				);
				for (const a of messagePendingApprovals) {
					removePendingApproval(a.callId);
				}
			} catch (error) {
				console.error('Failed to approve all tool calls:', error);
			}
		}, [sessionId, messagePendingApprovals, removePendingApproval]);

		// Sort parts by index to maintain correct order when tool results come in
		const parts = useMemo(() => {
			const rawParts = message.parts || [];
			return [...rawParts].sort((a, b) => {
				const indexDiff = (a.index ?? 0) - (b.index ?? 0);
				if (indexDiff !== 0) return indexDiff;
				const stepDiff = (a.stepIndex ?? 0) - (b.stepIndex ?? 0);
				if (stepDiff !== 0) return stepDiff;
				// Secondary sort by startedAt for parts with same index
				return (a.startedAt ?? 0) - (b.startedAt ?? 0);
			});
		}, [message.parts]);

		const hasFinish = parts.some((part) => part.toolName === 'finish');
		const latestProgressUpdateIndex = parts.reduce(
			(lastIndex, part, index) =>
				part.type === 'tool_result' && part.toolName === 'progress_update'
					? index
					: lastIndex,
			-1,
		);
		const latestProgressUpdatePart =
			latestProgressUpdateIndex >= 0 ? parts[latestProgressUpdateIndex] : null;
		const liveActionToolCallIds = new Set(
			parts
				.filter(
					(part) =>
						part.ephemeral &&
						[
							'shell',
							'bash',
							'edit',
							'multiedit',
							'write',
							'copy_into',
							'apply_patch',
							'terminal',
						].includes(part.toolName || ''),
				)
				.map((part) => part.toolCallId)
				.filter((callId): callId is string => Boolean(callId)),
		);
		const renderItems = useMemo(() => {
			const items: AssistantRenderItem[] = [];
			let compactBuffer: MessagePart[] = [];
			let bufferStartIndex = -1;
			let pendingTitle: string | undefined;

			const flushCompactBuffer = (nextTitle?: string) => {
				if (compactBuffer.length === 0) {
					if (nextTitle) {
						pendingTitle = nextTitle;
					}
					return;
				}

				const entries = buildCompactActivityEntries(compactBuffer);
				if (entries.length > 0) {
					items.push({
						kind: 'group',
						id: `compact-${compactBuffer[0].id}`,
						entries,
						titleOverride: pendingTitle,
					});
				} else {
					for (const [offset, part] of compactBuffer.entries()) {
						items.push({
							kind: 'part',
							index: bufferStartIndex + offset,
							part,
						});
					}
				}

				compactBuffer = [];
				bufferStartIndex = -1;
				pendingTitle = nextTitle;
			};

			for (const [index, part] of parts.entries()) {
				const isProgressUpdate =
					(part.type === 'tool_result' || part.type === 'tool_call') &&
					part.toolName === 'progress_update';

				if (isProgressUpdate) {
					let msg: string | undefined;
					const payload =
						part.contentJson && typeof part.contentJson === 'object'
							? part.contentJson
							: null;
					if (payload) {
						const bucket =
							(payload as Record<string, unknown>).args ??
							(payload as Record<string, unknown>).result;
						if (bucket && typeof bucket === 'object') {
							const m = (bucket as Record<string, unknown>).message;
							if (typeof m === 'string' && m.trim()) {
								msg = m.trim();
							}
						}
					}
					if (msg) {
						flushCompactBuffer(msg);
					}
					continue;
				}

				if (compact && isCompactActivityPart(part)) {
					if (compactBuffer.length === 0) {
						bufferStartIndex = index;
					}
					compactBuffer.push(part);
					continue;
				}

				flushCompactBuffer();
				items.push({ kind: 'part', index, part });
			}

			flushCompactBuffer();
			return items;
		}, [parts, compact]);
		const hasVisibleNonProgressParts = renderItems.length > 0;
		const firstVisiblePartIndex = parts.findIndex(
			(part) =>
				!(part.type === 'tool_result' && part.toolName === 'progress_update'),
		);
		const shouldShowProgressUpdate =
			message.status === 'pending' &&
			!hasFinish &&
			Boolean(latestProgressUpdatePart);
		const shouldShowLoadingFallback =
			message.status === 'pending' &&
			!hasFinish &&
			!latestProgressUpdatePart &&
			!isQueued;
		const formatTime = (ts?: number) => {
			if (!ts) return '';
			const date = new Date(ts);
			return date.toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit',
			});
		};

		const isComplete = message.status === 'complete';

		const handleCopy = useCallback(() => {
			const textParts = parts
				.filter((p) => p.type === 'text')
				.map((p) => {
					try {
						const parsed = JSON.parse(p.content || '{}');
						return parsed?.text || '';
					} catch {
						return p.content || '';
					}
				})
				.join('\n');

			navigator.clipboard.writeText(textParts);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}, [parts]);

		const handleBranchClick = useCallback(() => {
			setShowBranchModal(true);
		}, []);

		if (isQueued) {
			return null;
		}

		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: hover state for showing actions
			<div
				className="relative group"
				onMouseEnter={() => setIsHovered(true)}
				onMouseLeave={() => setIsHovered(false)}
			>
				{showHeader && (
					<div className="pb-2 flex items-center justify-between">
						<div className="inline-flex items-center bg-violet-500/10 border border-violet-500/30 dark:bg-violet-500/5 dark:border-violet-500/20 rounded-full pr-3 md:pr-4 flex-shrink min-w-0">
							<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-500/50 bg-violet-500/20 dark:bg-violet-500/10">
								<Sparkles className="h-3.5 w-3.5 text-violet-700 dark:text-violet-300" />
							</div>
							<div className="flex items-center gap-x-1.5 md:gap-x-2 text-xs md:text-sm text-muted-foreground pl-2 md:pl-3 min-w-0">
								{message.agent && (
									<span
										className="font-medium text-violet-700 dark:text-violet-300 whitespace-nowrap"
										title={message.agent}
									>
										{message.agent}
									</span>
								)}
								{message.provider && (
									<>
										{message.agent && (
											<span className="text-muted-foreground/50">·</span>
										)}
										<ProviderLogo
											provider={message.provider}
											size={14}
											className="opacity-70"
										/>
									</>
								)}
								{message.model && (
									<>
										<span className="hidden md:inline text-muted-foreground/50">
											·
										</span>
										<span
											className="hidden md:inline text-muted-foreground whitespace-nowrap"
											title={message.model}
										>
											{message.model}
										</span>
									</>
								)}
								{message.createdAt && (
									<>
										<span className="text-muted-foreground/50">·</span>
										<span className="text-muted-foreground whitespace-nowrap">
											{formatTime(message.createdAt)}
										</span>
									</>
								)}
							</div>
						</div>
						{isHovered && isComplete && sessionId && showBranchButton && (
							<button
								type="button"
								onClick={handleBranchClick}
								className="ml-4 p-1.5 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
								title="Branch from this message"
							>
								<GitBranch className="h-4 w-4" />
							</button>
						)}
					</div>
				)}

				<div className="relative ml-1">
					{renderItems.map((item, renderIndex) => {
						const hasFollowingContent =
							renderIndex < renderItems.length - 1 ||
							hasNextAssistantMessage ||
							shouldShowProgressUpdate ||
							shouldShowLoadingFallback;

						if (item.kind === 'group') {
							return (
								<CompactActivityGroup
									key={item.id}
									entries={item.entries}
									titleOverride={item.titleOverride}
									showLine={hasFollowingContent}
									collapsed={
										message.status !== 'pending' ||
										renderIndex < renderItems.length - 1
									}
									compact={compact}
								/>
							);
						}

						const { part, index } = item;
						const isLastPart = index === parts.length - 1;
						const isActionTool =
							part.ephemeral &&
							(part.type === 'tool_call' || part.type === 'tool_result') &&
							[
								'shell',
								'bash',
								'edit',
								'multiedit',
								'write',
								'copy_into',
								'apply_patch',
								'terminal',
							].includes(part.toolName || '');

						if (isActionTool) {
							return (
								<ActionToolBox
									key={part.id}
									part={part}
									showLine={hasFollowingContent}
									compact={compact}
								/>
							);
						}

						const pendingApproval =
							part.type === 'tool_call' && part.toolCallId
								? (pendingApprovals.find((a) => a.callId === part.toolCallId) ??
									null)
								: null;
						if (
							part.type === 'tool_result' &&
							part.toolCallId &&
							liveActionToolCallIds.has(part.toolCallId)
						) {
							return null;
						}
						const isFinishTool =
							part.type === 'tool_result' && part.toolName === 'finish';
						const showLine = hasFollowingContent && !isFinishTool;
						const isLastToolCall = part.type === 'tool_call' && isLastPart;

						return (
							<MessagePartItem
								key={part.id}
								part={part}
								showLine={showLine}
								isFirstPart={index === firstVisiblePartIndex && !showHeader}
								isLastToolCall={isLastToolCall}
								onNavigateToSession={onNavigateToSession}
								compact={compact}
								pendingApproval={pendingApproval}
								onApprove={handleApprove}
								onReject={handleReject}
								sessionId={sessionId}
								onRetry={onRetry}
								onCompact={onCompact}
							/>
						);
					})}

					{/* Approve All banner when multiple approvals pending */}
					{messagePendingApprovals.length > 1 && (
						<div className="flex items-center gap-3 py-2 px-3 my-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
							<Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
							<span className="text-sm text-amber-800 dark:text-amber-200 flex-1">
								{messagePendingApprovals.length} tools waiting for approval
							</span>
							<button
								type="button"
								onClick={handleApproveAll}
								title="Approve All (A)"
								className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors"
							>
								<CheckCheck className="w-3.5 h-3.5" />
								Approve All
								<kbd className="ml-1 text-[10px] opacity-70">A</kbd>
							</button>
						</div>
					)}

					{shouldShowProgressUpdate && latestProgressUpdatePart && (
						<MessagePartItem
							key={latestProgressUpdatePart.id}
							part={latestProgressUpdatePart}
							showLine={hasNextAssistantMessage}
							isFirstPart={!hasVisibleNonProgressParts && !showHeader}
							isLastProgressUpdate
							compact={compact}
						/>
					)}

					{shouldShowLoadingFallback && (
						<div
							className={`flex ${
								isCompactThread ? 'gap-1.5' : 'gap-3'
							} pb-2 relative max-w-full overflow-hidden`}
						>
							<div
								className={`flex-shrink-0 ${
									isCompactThread ? 'w-4' : 'w-6'
								} flex items-center justify-center relative`}
							>
								<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative bg-card text-violet-700 dark:bg-background dark:text-violet-300">
									<StableSpinner title="Assistant is working" />
								</div>
								{hasNextAssistantMessage && (
									<div
										className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-border z-0"
										style={{ top: '1.25rem', bottom: '-0.5rem' }}
									/>
								)}
							</div>
							<div className="flex-1 min-w-0">
								<div className="text-base leading-5 text-foreground animate-pulse">
									{getLoadingMessage(message.id)}
								</div>
							</div>
						</div>
					)}
				</div>

				{isComplete && sessionId && (
					<div
						className="grid ml-7 transition-[grid-template-rows] duration-200 ease-out"
						style={{ gridTemplateRows: isHovered ? '1fr' : '0fr' }}
					>
						<div className="overflow-hidden">
							<div className="flex gap-2 mt-2">
								{showBranchButton && (
									<button
										type="button"
										onClick={handleBranchClick}
										className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
									>
										<GitBranch className="h-3 w-3" />
										Branch
									</button>
								)}
								<button
									type="button"
									onClick={handleCopy}
									className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
								>
									{copied ? (
										<>
											<Check className="h-3 w-3 text-green-500" />
											Copied
										</>
									) : (
										<>
											<Copy className="h-3 w-3" />
											Copy
										</>
									)}
								</button>
							</div>
						</div>
					</div>
				)}

				{showBranchModal && sessionId && (
					<BranchModal
						isOpen={showBranchModal}
						onClose={() => setShowBranchModal(false)}
						sessionId={sessionId}
						message={message}
						onBranchCreated={onBranchCreated}
					/>
				)}
			</div>
		);
	},
	(prevProps, nextProps) => {
		const prevParts = prevProps.message.parts || [];
		const nextParts = nextProps.message.parts || [];

		if (prevParts.length !== nextParts.length) {
			return false;
		}

		for (let i = 0; i < prevParts.length; i++) {
			const prevPart = prevParts[i];
			const nextPart = nextParts[i];
			if (
				prevPart.id !== nextPart.id ||
				prevPart.index !== nextPart.index ||
				prevPart.stepIndex !== nextPart.stepIndex ||
				prevPart.type !== nextPart.type ||
				prevPart.content !== nextPart.content ||
				prevPart.toolName !== nextPart.toolName ||
				prevPart.toolCallId !== nextPart.toolCallId ||
				prevPart.ephemeral !== nextPart.ephemeral ||
				prevPart.completedAt !== nextPart.completedAt ||
				prevPart.startedAt !== nextPart.startedAt
			) {
				return false;
			}
		}

		return (
			prevProps.message.id === nextProps.message.id &&
			prevProps.message.status === nextProps.message.status &&
			prevProps.message.completedAt === nextProps.message.completedAt &&
			prevProps.showHeader === nextProps.showHeader &&
			prevProps.hasNextAssistantMessage === nextProps.hasNextAssistantMessage &&
			prevProps.isLastMessage === nextProps.isLastMessage &&
			prevProps.sessionId === nextProps.sessionId &&
			prevProps.compact === nextProps.compact &&
			prevProps.onNavigateToSession === nextProps.onNavigateToSession
		);
	},
);
