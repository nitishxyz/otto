import { memo, useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
	Check,
	CheckCheck,
	Copy,
	GitBranch,
	Shield,
	Sparkles,
	Files,
	ChevronDown,
} from 'lucide-react';
import type { Message, MessagePart } from '../../types/api';
import type { ThreadRow } from './threadRowModel';
import { MessagePartItem } from './MessagePartItem';
import { CompactionSummaryBox } from './CompactionSummaryBox';
import { CompactActivityGroup } from './CompactActivityGroup';
import type { CompactActivityEntry } from './compactActivity';
import { ActionToolBox } from './ActionToolBox';
import { BranchModal } from '../branch/BranchModal';
import { ProviderLogo } from '../common/ProviderLogo';
import { StableSpinner } from '../ui/StableSpinner';
import { useToolApprovalStore } from '../../stores/toolApprovalStore';
import { apiClient } from '../../lib/api-client';
import {
	getLoadingMessage,
	type PreloadedContextSummary,
} from './assistantTurnModel';
import { useIsCompactThread } from './threadDensity';
import { useIsMessageHovered } from './messageHoverStore';
import { ShowWorkToggle } from './ShowWorkToggle';
import { useTurnWorkStore } from './turnWorkStore';

const STATUS_LINE_MOTION = {
	initial: { opacity: 0, y: 6, filter: 'blur(2px)' },
	animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
	exit: { opacity: 0, y: -6, filter: 'blur(2px)' },
	transition: { duration: 0.16, ease: 'easeOut' },
} as const;

function formatTime(ts?: number) {
	if (!ts) return '';
	return new Date(ts).toLocaleTimeString([], {
		hour: '2-digit',
		minute: '2-digit',
	});
}

interface AssistantHeaderRowProps {
	sessionId?: string;
	message: Message;
	onBranchCreated?: (sessionId: string) => void;
}

export const AssistantHeaderRow = memo(function AssistantHeaderRow({
	sessionId,
	message,
	onBranchCreated,
}: AssistantHeaderRowProps) {
	const isHovered = useIsMessageHovered(message.id);
	const [showBranchModal, setShowBranchModal] = useState(false);
	const isComplete = message.status === 'complete';

	return (
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
							<span className="text-muted-foreground/50 flex-shrink-0">·</span>
							<span className="text-muted-foreground whitespace-nowrap flex-shrink-0">
								{formatTime(message.createdAt)}
							</span>
						</>
					)}
				</div>
			</div>
			{isHovered && isComplete && sessionId && (
				<button
					type="button"
					onClick={() => setShowBranchModal(true)}
					className="ml-4 p-1.5 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
					title="Branch from this message"
				>
					<GitBranch className="h-4 w-4" />
				</button>
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
});

export const AssistantContextRow = memo(function AssistantContextRow({
	context,
}: {
	context: PreloadedContextSummary;
}) {
	const [expanded, setExpanded] = useState(false);
	return (
		<div className="rounded-lg border border-border/60 bg-muted/30 text-xs text-muted-foreground">
			<button
				type="button"
				onClick={() => setExpanded((current) => !current)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left hover:text-foreground transition-colors"
				aria-expanded={expanded}
			>
				<Files className="h-3.5 w-3.5 shrink-0" />
				<span className="font-medium text-foreground/80">
					{context.files.length} {context.files.length === 1 ? 'file' : 'files'}{' '}
					preloaded
				</span>
				{context.totalBytes !== undefined && (
					<span>· {Math.ceil(context.totalBytes / 1024)} KB</span>
				)}
				{context.preloadDurationMs !== undefined && (
					<span>· {context.preloadDurationMs} ms</span>
				)}
				<ChevronDown
					className={`ml-auto h-3.5 w-3.5 transition-transform ${
						expanded ? 'rotate-180' : ''
					}`}
				/>
			</button>
			{expanded && (
				<div className="border-t border-border/50 px-3 py-2">
					<ul className="space-y-1 font-mono text-[11px]">
						{context.files.map((file, index) => (
							<li
								key={`${file.path}:${file.lineRange ?? 'full'}:${index}`}
								className="truncate"
								title={file.path}
							>
								{file.path}
								{file.lineRange ? `:${file.lineRange}` : ''}
							</li>
						))}
					</ul>
					{Boolean(context.deduplicatedFileCount) && (
						<p className="mt-2">
							{context.deduplicatedFileCount} duplicate{' '}
							{context.deduplicatedFileCount === 1
								? 'reference was'
								: 'references were'}{' '}
							removed.
						</p>
					)}
				</div>
			)}
		</div>
	);
});

type AssistantItemRow = Extract<ThreadRow, { kind: 'assistant-item' }>;

/**
 * Height of the placeholder rendered for a part with no timeline content. It is
 * a real, measurable box (never `null`, never zero) so the list keeps a stable
 * size for the row, and it is small enough to be invisible.
 */
const SUPPRESSED_PART_STYLE = { height: 1 } as const;

/**
 * A persisted part that is intentionally not shown here: its payload is
 * rendered by the live status row or the todo panel, or it is empty. The part
 * still owns this row, so the part → row mapping stays 1:1 and the row's height
 * never collapses to zero.
 */
export const SuppressedPartRow = memo(function SuppressedPartRow({
	partId,
}: {
	partId: string;
}) {
	return (
		<div
			aria-hidden="true"
			data-suppressed-part={partId}
			className="pointer-events-none select-none"
			style={SUPPRESSED_PART_STYLE}
		/>
	);
});

interface AssistantItemRowProps {
	messageId: string;
	/** Exactly one persisted (or ephemeral) part per row — never a group. */
	part: MessagePart;
	variant: AssistantItemRow['variant'];
	showLine: boolean;
	isFirstPart: boolean;
	/** True while this tool call has no result yet and shows its live box. */
	isLiveToolCall: boolean;
	isLastMessage: boolean;
	canRetry: boolean;
	sessionId?: string;
	compact: boolean;
	onNavigateToSession?: (sessionId: string) => void;
	onRetryMessage?: (messageId: string) => void;
	onCompact?: () => void;
}

/** One message part, rendered with its existing renderer. */
export const AssistantItemRow = memo(function AssistantItemRow({
	messageId,
	part,
	variant,
	showLine,
	isFirstPart,
	isLiveToolCall,
	isLastMessage,
	canRetry,
	sessionId,
	compact,
	onNavigateToSession,
	onRetryMessage,
	onCompact,
}: AssistantItemRowProps) {
	const toolCallId = part.toolCallId;
	// Selecting only this part's approval keeps approval churn from
	// re-rendering every other row in the turn.
	const pendingApproval = useToolApprovalStore(
		useCallback(
			(state) =>
				toolCallId
					? (state.pendingApprovals.find(
							(approval) => approval.callId === toolCallId,
						) ?? null)
					: null,
			[toolCallId],
		),
	);
	const removePendingApproval = useToolApprovalStore(
		(state) => state.removePendingApproval,
	);

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

	const handleRetry = useCallback(() => {
		onRetryMessage?.(messageId);
	}, [onRetryMessage, messageId]);

	if (variant === 'suppressed') {
		return <SuppressedPartRow partId={part.id} />;
	}

	if (variant === 'compaction') {
		return (
			<CompactionSummaryBox part={part} showLine={showLine} compact={compact} />
		);
	}

	if (variant === 'action') {
		return (
			<ActionToolBox
				part={part}
				showLine={showLine}
				compact={compact}
				sessionId={sessionId}
			/>
		);
	}

	return (
		<MessagePartItem
			part={part}
			showLine={showLine}
			isFirstPart={isFirstPart}
			// The renderer's flag is positional in name only: it asks "does this
			// call still show its live box", which is exactly `isLiveToolCall`.
			isLastToolCall={isLiveToolCall}
			onNavigateToSession={onNavigateToSession}
			compact={compact}
			pendingApproval={pendingApproval}
			onApprove={handleApprove}
			onReject={handleReject}
			sessionId={sessionId}
			onRetry={canRetry && onRetryMessage ? handleRetry : undefined}
			onCompact={isLastMessage ? onCompact : undefined}
		/>
	);
});

interface AssistantCompactGroupRowProps {
	/** One keyed entry per part of the run; identity is stable per part. */
	entries: CompactActivityEntry[];
	titleOverride?: string;
	collapsed: boolean;
	showLine: boolean;
}

/**
 * A contiguous run of compact exploratory activity, rendered as the single
 * bordered activity box the compact thread has always used: a height-capped,
 * auto-scrolling log while the run is live, collapsing to a one-line summary
 * once it is done.
 */
export const AssistantCompactGroupRow = memo(function AssistantCompactGroupRow({
	entries,
	titleOverride,
	collapsed,
	showLine,
}: AssistantCompactGroupRowProps) {
	return (
		<CompactActivityGroup
			entries={entries}
			titleOverride={titleOverride}
			showLine={showLine}
			collapsed={collapsed}
			// A box only exists when the turn is being compacted at all (compact
			// thread or auto-compacted long turn), which is exactly when the
			// pre-refactor renderer passed `compact` down to it.
			compact
		/>
	);
});

interface AssistantApprovalsRowProps {
	sessionId?: string;
	messageId: string;
}

/** "Approve all" banner; only mounts while a turn is waiting on approvals. */
export const AssistantApprovalsRow = memo(function AssistantApprovalsRow({
	sessionId,
	messageId,
}: AssistantApprovalsRowProps) {
	const pendingApprovals = useToolApprovalStore(
		(state) => state.pendingApprovals,
	);
	const removePendingApproval = useToolApprovalStore(
		(state) => state.removePendingApproval,
	);
	const messagePendingApprovals = useMemo(
		() => pendingApprovals.filter((a) => a.messageId === messageId),
		[pendingApprovals, messageId],
	);

	const handleApproveAll = useCallback(async () => {
		if (!sessionId) return;
		try {
			await Promise.all(
				messagePendingApprovals.map((a) =>
					apiClient.approveToolCall(sessionId, a.callId, true),
				),
			);
			for (const approval of messagePendingApprovals) {
				removePendingApproval(approval.callId);
			}
		} catch (error) {
			console.error('Failed to approve all tool calls:', error);
		}
	}, [sessionId, messagePendingApprovals, removePendingApproval]);

	if (messagePendingApprovals.length <= 1) return null;

	return (
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
	);
});

interface AssistantStatusRowProps {
	messageId: string;
	variant: 'tool' | 'progress' | 'loading';
	part: MessagePart | null;
	showLine: boolean;
	isFirstPart: boolean;
	compact: boolean;
}

/** Live status line (tool call / progress update / generic loading copy). */
export const AssistantStatusRow = memo(function AssistantStatusRow({
	messageId,
	variant,
	part,
	showLine,
	isFirstPart,
	compact,
}: AssistantStatusRowProps) {
	const isCompactDensity = useIsCompactThread();
	const isCompactThread = Boolean(compact || isCompactDensity);

	return (
		<AnimatePresence mode="wait" initial={false}>
			{variant === 'tool' && part ? (
				<motion.div key={`status-tool-${part.id}`} {...STATUS_LINE_MOTION}>
					<MessagePartItem
						part={part}
						showLine={showLine}
						isFirstPart={isFirstPart}
						isLastToolCall
						isStatusLineToolCall
						compact={compact}
					/>
				</motion.div>
			) : variant === 'progress' && part ? (
				<motion.div key={`status-progress-${part.id}`} {...STATUS_LINE_MOTION}>
					<MessagePartItem
						part={part}
						showLine={showLine}
						isFirstPart={isFirstPart}
						isLastProgressUpdate
						compact={compact}
					/>
				</motion.div>
			) : variant === 'loading' ? (
				<motion.div key={`status-loading-${messageId}`} {...STATUS_LINE_MOTION}>
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
							{showLine && (
								<div
									className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-border z-0"
									style={{ top: '1.25rem', bottom: '-0.5rem' }}
								/>
							)}
						</div>
						<div className="flex-1 min-w-0">
							<div className="text-base leading-5 text-foreground animate-pulse">
								{getLoadingMessage(messageId)}
							</div>
						</div>
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
});

export const AssistantErrorRow = memo(function AssistantErrorRow({
	error,
}: {
	error: string;
}) {
	return (
		<div className="ml-7 mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
			{error}
		</div>
	);
});

interface AssistantFooterRowProps {
	sessionId?: string;
	message: Message;
	onBranchCreated?: (sessionId: string) => void;
}

interface AssistantShowWorkRowProps {
	messageId: string;
	expanded: boolean;
	compact: boolean;
}

/** Horizontal-rule toggle that reveals an older turn's tool work. */
export const AssistantShowWorkRow = memo(function AssistantShowWorkRow({
	messageId,
	expanded,
	compact,
}: AssistantShowWorkRowProps) {
	const toggleExpanded = useTurnWorkStore((state) => state.toggleExpanded);
	return (
		<ShowWorkToggle
			expanded={expanded}
			onToggle={() => toggleExpanded(messageId)}
			compact={compact}
		/>
	);
});

/** Hover-revealed branch/copy actions that close out an assistant turn. */
export const AssistantFooterRow = memo(function AssistantFooterRow({
	sessionId,
	message,
	onBranchCreated,
}: AssistantFooterRowProps) {
	const isHovered = useIsMessageHovered(message.id);
	const [copied, setCopied] = useState(false);
	const [showBranchModal, setShowBranchModal] = useState(false);

	const handleCopy = useCallback(() => {
		const textParts = (message.parts ?? [])
			.filter((part) => part.type === 'text')
			.map((part) => {
				try {
					const parsed = JSON.parse(part.content || '{}');
					return parsed?.text || '';
				} catch {
					return part.content || '';
				}
			})
			.join('\n');

		navigator.clipboard.writeText(textParts);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [message.parts]);

	return (
		<div className="ml-7 mt-2 min-h-7">
			<div
				className={`flex gap-2 transition-opacity duration-150 ${
					isHovered ? 'opacity-100' : 'pointer-events-none opacity-0'
				}`}
			>
				<button
					type="button"
					onClick={() => setShowBranchModal(true)}
					tabIndex={isHovered ? 0 : -1}
					className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
				>
					<GitBranch className="h-3 w-3" />
					Branch
				</button>
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
});
