import { AnimatePresence, motion } from 'motion/react';
import {
	memo,
	useState,
	useCallback,
	useMemo,
	useEffect,
	Fragment,
} from 'react';
import {
	Sparkles,
	GitBranch,
	Copy,
	Check,
	Shield,
	CheckCheck,
} from 'lucide-react';
import type { Message } from '../../types/api';
import { MessagePartItem } from './MessagePartItem';
import { CompactActivityGroup } from './CompactActivityGroup';
import { CompactionSummaryBox } from './CompactionSummaryBox';
import { ActionToolBox } from './ActionToolBox';
import { shouldRenderCompactionSummaryBox } from './compactionSummary';
import { shouldRenderTurnFooter } from './turnFooter';
import { useMessageQueuePosition } from '../../hooks/useQueueState';
import { BranchModal } from '../branch/BranchModal';
import { ProviderLogo } from '../common/ProviderLogo';
import { StableSpinner } from '../ui/StableSpinner';
import { useToolApprovalStore } from '../../stores/toolApprovalStore';
import { apiClient } from '../../lib/api-client';
import {
	type AssistantRenderItem,
	PART_WINDOW_HEAD_COUNT,
	deriveAssistantTurn,
	getLoadingMessage,
	getRenderItemKey,
	isActionToolPart,
} from './assistantTurnModel';
import { HiddenAssistantStepsRow } from './HiddenAssistantStepsRow';
import { ShowWorkToggle } from './ShowWorkToggle';
import { useIsCompactThread } from './threadDensity';
import {
	getTrailingAnswerRenderStart,
	isWorkRenderItem,
	type TurnWorkContext,
} from './turnWork';

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
	previousUserMessage?: Message;
}

export const AssistantMessageGroup = memo(
	function AssistantMessageGroup({
		sessionId,
		message,
		showHeader,
		hasNextAssistantMessage,
		isLastMessage,
		onBranchCreated,
		compact,
		showBranchButton = true,
		onNavigateToSession,
		onRetry,
		onCompact,
		previousUserMessage,
	}: AssistantMessageGroupProps) {
		const { isQueued } = useMessageQueuePosition(sessionId, message.id);
		const isCompactDensity = useIsCompactThread();
		const isCompactThread = Boolean(compact || isCompactDensity);
		const [isHovered, setIsHovered] = useState(false);
		const [showBranchModal, setShowBranchModal] = useState(false);
		const [copied, setCopied] = useState(false);
		const [showAllParts, setShowAllParts] = useState(false);
		const [workExpanded, setWorkExpanded] = useState(false);

		useEffect(() => {
			if (!message.id) return;
			setShowAllParts(false);
			setWorkExpanded(false);
		}, [message.id]);

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

		const {
			parts,
			renderItems,
			visibleRenderItems,
			omittedRenderItemCount,
			autoCompactActivity,
			liveActionToolCallIds,
			completedActionToolCallIds,
			resolvedToolCallIds,
			firstVisiblePartIndex,
			hasVisibleNonProgressParts,
			latestProgressUpdatePart,
			latestStatusLineToolCallPart,
			shouldShowStatusLineToolCall,
			shouldShowProgressUpdate,
			shouldShowLoadingFallback,
			shouldShowErrorFallback,
		} = useMemo(
			() => deriveAssistantTurn(message, { compact, isQueued, showAllParts }),
			[message, compact, isQueued, showAllParts],
		);
		const workContext = useMemo<TurnWorkContext>(
			() => ({ resolvedToolCallIds, completedActionToolCallIds }),
			[resolvedToolCallIds, completedActionToolCallIds],
		);
		const hasWork = useMemo(
			() => renderItems.some((item) => isWorkRenderItem(item, workContext)),
			[renderItems, workContext],
		);
		const showWorkToggle =
			!isLastMessage && message.status !== 'pending' && hasWork;
		const collapseWork = showWorkToggle && !workExpanded;
		const displayedRenderItems = useMemo(() => {
			if (!collapseWork) return visibleRenderItems;
			const answerStart = getTrailingAnswerRenderStart(
				renderItems,
				workContext,
			);
			return renderItems.flatMap((item, renderIndex) => {
				if (isWorkRenderItem(item, workContext)) return [];
				if (
					item.kind === 'part' &&
					(item.part.type === 'text' || item.part.type === 'reasoning') &&
					renderIndex < answerStart
				) {
					return [];
				}
				return [{ item, renderIndex }];
			});
		}, [collapseWork, visibleRenderItems, renderItems, workContext]);
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

		const statusLineMotion = {
			initial: { opacity: 0, y: 6, filter: 'blur(2px)' },
			animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
			exit: { opacity: 0, y: -6, filter: 'blur(2px)' },
			transition: { duration: 0.16, ease: 'easeOut' },
		} as const;

		const renderAssistantRenderItem = (
			item: AssistantRenderItem,
			renderIndex: number,
		) => {
			const hasFollowingContent =
				renderIndex < renderItems.length - 1 ||
				hasNextAssistantMessage ||
				shouldShowStatusLineToolCall ||
				shouldShowProgressUpdate ||
				shouldShowLoadingFallback;

			if (item.kind === 'group') {
				return (
					<CompactActivityGroup
						entries={item.entries}
						titleOverride={item.titleOverride}
						showLine={hasFollowingContent}
						collapsed={
							message.status !== 'pending' ||
							renderIndex < renderItems.length - 1
						}
						compact={compact || autoCompactActivity}
					/>
				);
			}

			const { part, index } = item;
			const isLastPart = index === parts.length - 1;

			if (
				shouldRenderCompactionSummaryBox({
					compact,
					part,
					previousUserMessage,
				})
			) {
				return (
					<CompactionSummaryBox
						part={part}
						showLine={hasFollowingContent}
						compact={compact}
					/>
				);
			}

			const isActionTool = isActionToolPart(part);

			if (isActionTool) {
				return (
					<ActionToolBox
						part={part}
						showLine={hasFollowingContent}
						compact={compact}
						sessionId={sessionId}
					/>
				);
			}

			const pendingApproval =
				part.type === 'tool_call' && part.toolCallId
					? (pendingApprovals.find((a) => a.callId === part.toolCallId) ?? null)
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
		};

		if (isQueued) {
			return null;
		}

		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: hover state for showing actions
			<div
				className="relative group"
				onMouseEnter={() => setIsHovered(true)}
				onMouseLeave={() => {
					setIsHovered(false);
					setCopied(false);
				}}
				onBlur={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
						setIsHovered(false);
					}
				}}
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
										className="font-medium text-violet-700 dark:text-violet-300 whitespace-nowrap flex-shrink-0"
										title={message.agent}
									>
										{message.agent}
									</span>
								)}
								{message.provider && (
									<>
										{message.agent && (
											<span className="text-muted-foreground/50 flex-shrink-0">
												·
											</span>
										)}
										<ProviderLogo
											provider={message.provider}
											size={14}
											className="opacity-70 flex-shrink-0"
										/>
									</>
								)}
								{message.model && (
									<>
										<span className="hidden md:inline text-muted-foreground/50 flex-shrink-0">
											·
										</span>
										<span
											className="hidden md:inline truncate text-muted-foreground min-w-0"
											title={message.model}
										>
											{message.model}
										</span>
									</>
								)}
								{message.createdAt && (
									<>
										<span className="text-muted-foreground/50 flex-shrink-0">
											·
										</span>
										<span className="text-muted-foreground whitespace-nowrap flex-shrink-0">
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

				{showWorkToggle && (
					<ShowWorkToggle
						expanded={workExpanded}
						onToggle={() => setWorkExpanded((current) => !current)}
						compact={compact}
					/>
				)}

				<div className="relative ml-1">
					{displayedRenderItems.map(({ item, renderIndex }, visibleIndex) => {
						const showPartWindowGap =
							!collapseWork &&
							omittedRenderItemCount > 0 &&
							visibleIndex === PART_WINDOW_HEAD_COUNT;
						return (
							<Fragment key={getRenderItemKey(item)}>
								{showPartWindowGap && (
									<HiddenAssistantStepsRow
										count={omittedRenderItemCount}
										onShowAll={() => setShowAllParts(true)}
										compact={compact}
									/>
								)}
								{renderAssistantRenderItem(item, renderIndex)}
							</Fragment>
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

					<AnimatePresence mode="wait" initial={false}>
						{shouldShowStatusLineToolCall && latestStatusLineToolCallPart ? (
							<motion.div
								key={`status-tool-${latestStatusLineToolCallPart.id}`}
								{...statusLineMotion}
							>
								<MessagePartItem
									part={latestStatusLineToolCallPart}
									showLine={hasNextAssistantMessage}
									isFirstPart={!hasVisibleNonProgressParts && !showHeader}
									isLastToolCall
									isStatusLineToolCall
									compact={compact}
								/>
							</motion.div>
						) : shouldShowProgressUpdate && latestProgressUpdatePart ? (
							<motion.div
								key={`status-progress-${latestProgressUpdatePart.id}`}
								{...statusLineMotion}
							>
								<MessagePartItem
									part={latestProgressUpdatePart}
									showLine={hasNextAssistantMessage}
									isFirstPart={!hasVisibleNonProgressParts && !showHeader}
									isLastProgressUpdate
									compact={compact}
								/>
							</motion.div>
						) : shouldShowLoadingFallback ? (
							<motion.div
								key={`status-loading-${message.id}`}
								{...statusLineMotion}
							>
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
							</motion.div>
						) : null}
					</AnimatePresence>

					{shouldShowErrorFallback && (
						<div className="ml-7 mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{message.error}
						</div>
					)}
				</div>

				{shouldRenderTurnFooter(
					message,
					sessionId,
					hasNextAssistantMessage,
				) && (
					<div className="ml-7 mt-2 min-h-7">
						<div
							className={`flex gap-2 transition-opacity duration-150 ${
								isHovered ? 'opacity-100' : 'pointer-events-none opacity-0'
							}`}
						>
							{showBranchButton && (
								<button
									type="button"
									onClick={handleBranchClick}
									tabIndex={isHovered ? 0 : -1}
									className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
								>
									<GitBranch className="h-3 w-3" />
									Branch
								</button>
							)}
							<button
								type="button"
								onClick={handleCopy}
								tabIndex={isHovered ? 0 : -1}
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
