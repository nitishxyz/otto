import type { Message, MessagePart } from '../../types/api';
import {
	getAssistantTurn,
	getProgressUpdateMessage,
	isActionToolPart,
} from './assistantTurnModel';
import {
	type CompactActivityEntry,
	buildCompactActivityEntries,
	isCompactActivityPart,
} from './compactActivity';
import {
	type PartPresentation,
	getPartPresentation,
	isLiveToolCallPart,
} from './partVisibility';
import {
	getUserMessageText,
	isCompactSlashCommand,
	shouldRenderCompactionSummaryBox,
} from './compactionSummary';
import { shouldRenderTurnFooter } from './turnFooter';

/**
 * The thread renders one list row per *persisted message part*, plus separate
 * rows for the chrome around a turn (headers, live status, approvals, errors,
 * footers), so a streaming part invalidates and re-lays out only its own row.
 *
 * The single exception is compact-thread exploratory activity. There a
 * contiguous run of reads/searches/reasoning parts is presented as *one*
 * bordered, height-constrained activity box that collapses to a one-line
 * summary when the run is finished — see {@link CompactActivityGroup}. That
 * presentation is a property of the run, not of any single part, so the run
 * owns one row (`assistant-compact-group`) keyed on its first part. Inside the
 * row every part still keeps its own keyed entry, and the row's identity only
 * changes when one of its own parts changes.
 */
export type ThreadRow =
	| {
			kind: 'user';
			key: string;
			messageId: string;
			endsTurn: boolean;
			message: Message;
			/**
			 * Deliberately no positional field here: a user row must not depend on
			 * its index in the thread, otherwise prepending an older page would
			 * invalidate the previously first row and cost a re-measure.
			 */
			nextAssistantMessageId?: string;
	  }
	| {
			kind: 'assistant-header';
			key: string;
			messageId: string;
			endsTurn: boolean;
			message: Message;
	  }
	| {
			kind: 'assistant-item';
			key: string;
			messageId: string;
			endsTurn: boolean;
			/** The single persisted (or ephemeral) part this row renders. */
			part: MessagePart;
			/**
			 * Renderer selected up-front so the row component stays thin.
			 * `suppressed` parts have no timeline content (their payload belongs to
			 * the status row or the todo panel, or they are empty) but still own a
			 * measurable row, so the part → row mapping stays 1:1.
			 */
			variant: 'compaction' | 'action' | 'part' | 'suppressed';
			showLine: boolean;
			isFirstPart: boolean;
			/**
			 * True while this tool call has no persisted result yet, i.e. it still
			 * renders its live box. Derived from the call's own result rather than
			 * from its position, so later parts never resize this row.
			 */
			isLiveToolCall: boolean;
			isLastMessage: boolean;
			canRetry: boolean;
	  }
	| {
			/**
			 * One contiguous run of compact exploratory activity, rendered as the
			 * single bordered/scrolling activity box the compact thread has always
			 * used. Keyed on the run's first part so the row survives every append
			 * to the run.
			 */
			kind: 'assistant-compact-group';
			key: string;
			messageId: string;
			endsTurn: boolean;
			/** The persisted parts this box covers, in thread order. */
			parts: MessagePart[];
			/** One keyed entry per rendered part; identity is stable per part. */
			entries: CompactActivityEntry[];
			/** Latest `progress_update` text, used as the collapsed title. */
			titleOverride?: string;
			/** Collapsed runs show the one-line summary instead of the log. */
			collapsed: boolean;
			showLine: boolean;
	  }
	| {
			kind: 'assistant-approvals';
			key: string;
			messageId: string;
			endsTurn: boolean;
	  }
	| {
			kind: 'assistant-status';
			key: string;
			messageId: string;
			endsTurn: boolean;
			message: Message;
			variant: 'tool' | 'progress' | 'loading';
			part: MessagePart | null;
			showLine: boolean;
			isFirstPart: boolean;
	  }
	| {
			kind: 'assistant-error';
			key: string;
			messageId: string;
			endsTurn: boolean;
			error: string;
	  }
	| {
			kind: 'assistant-footer';
			key: string;
			messageId: string;
			endsTurn: boolean;
			message: Message;
	  };

export interface ThreadRowsResult {
	rows: ThreadRow[];
	/** Row index of the first row of each visible message, for the navigator. */
	rowIndexByMessageIndex: number[];
}

/**
 * Presentation class of a row, used as LegendList's `getItemType`.
 *
 * The list keeps a running size average *per type*, so the types have to track
 * what actually drives height rather than just the row's kind: a one-line
 * suppressed placeholder, a paragraph of markdown, a tool card and a collapsed
 * activity summary differ by an order of magnitude. Mixing them into one
 * average is what makes predicted offsets wrong during a fast flick, which is
 * what surfaces as blank rows.
 */
export function getThreadRowType(row: ThreadRow): string {
	switch (row.kind) {
		case 'user':
			return 'user';
		case 'assistant-header':
			return 'header';
		case 'assistant-item': {
			if (row.variant !== 'part') return `item:${row.variant}`;
			switch (row.part.type) {
				case 'text':
					return 'item:text';
				case 'reasoning':
					return 'item:reasoning';
				case 'tool_call':
				case 'tool_result':
					return 'item:tool';
				case 'image':
				case 'file':
					return 'item:media';
				case 'error':
					return 'item:error';
				default:
					return 'item:other';
			}
		}
		case 'assistant-compact-group':
			return row.collapsed ? 'group:collapsed' : 'group:live';
		case 'assistant-approvals':
			return 'approvals';
		case 'assistant-status':
			return `status:${row.variant}`;
		case 'assistant-error':
			return 'error';
		case 'assistant-footer':
			return 'footer';
	}
}

interface BuildThreadRowsOptions {
	messages: Message[];
	sessionId?: string;
	compact: boolean;
	currentMessageId: string | null;
	queueLength: number;
	queuedMessageIds: ReadonlySet<string>;
	/**
	 * Per-thread row identity cache. Threads can be mounted side by side (the
	 * subagent viewer over a session, canvas blocks, desktop panes), and they
	 * must not share one cache: each build evicts the keys it did not see, so a
	 * shared cache would recreate every row of the *other* thread on every
	 * rebuild and force LegendList to re-measure its whole viewport.
	 */
	cache?: ThreadRowCache;
}

/**
 * Rows are recreated on every rebuild, but LegendList keeps measurements only
 * while item identity is stable. Reusing the previous row object whenever every
 * field is unchanged is what stops a prepend (or an unrelated stream delta)
 * from invalidating the whole viewport.
 */
export type ThreadRowCache = Map<string, ThreadRow>;

/** Creates a row identity cache scoped to a single thread instance. */
export function createThreadRowCache(): ThreadRowCache {
	return new Map();
}

/** Fallback cache for callers that do not own one (tests, one-off renders). */
const defaultRowIdentityCache: ThreadRowCache = createThreadRowCache();

/** Element-wise identity comparison of a grouped run's parts. */
function samePartRun(
	left: readonly MessagePart[],
	right: readonly MessagePart[],
) {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

/**
 * The fields the assistant header actually renders. A streaming turn replaces
 * its `Message` object on every delta, but none of these change while it
 * streams — so comparing them (instead of the object) keeps the header of the
 * live turn stable while parts append below it.
 */
function sameHeaderFields(left: Message, right: Message) {
	return (
		left.id === right.id &&
		left.status === right.status &&
		left.agent === right.agent &&
		left.provider === right.provider &&
		left.model === right.model &&
		left.createdAt === right.createdAt
	);
}

function sameRow(left: ThreadRow, right: ThreadRow): boolean {
	if (left.kind !== right.kind) return false;
	if (left.key !== right.key) return false;
	if (left.endsTurn !== right.endsTurn) return false;
	switch (left.kind) {
		case 'user': {
			const next = right as Extract<ThreadRow, { kind: 'user' }>;
			return (
				left.message === next.message &&
				left.nextAssistantMessageId === next.nextAssistantMessageId
			);
		}
		case 'assistant-header': {
			const next = right as Extract<ThreadRow, { kind: 'assistant-header' }>;
			if (left.message === next.message) return true;
			// Only a *pending* turn gets the relaxed comparison: its header's
			// branch action is gated on `complete`, so nothing else about the
			// message can reach the DOM while it streams.
			return (
				left.message.status === 'pending' &&
				next.message.status === 'pending' &&
				sameHeaderFields(left.message, next.message)
			);
		}
		case 'assistant-footer': {
			const next = right as Extract<ThreadRow, { kind: 'assistant-footer' }>;
			return left.message === next.message;
		}
		case 'assistant-item': {
			const next = right as Extract<ThreadRow, { kind: 'assistant-item' }>;
			return (
				left.part === next.part &&
				left.variant === next.variant &&
				left.showLine === next.showLine &&
				left.isFirstPart === next.isFirstPart &&
				left.isLiveToolCall === next.isLiveToolCall &&
				left.isLastMessage === next.isLastMessage &&
				left.canRetry === next.canRetry
			);
		}
		case 'assistant-compact-group': {
			const next = right as Extract<
				ThreadRow,
				{ kind: 'assistant-compact-group' }
			>;
			return (
				left.collapsed === next.collapsed &&
				left.showLine === next.showLine &&
				left.titleOverride === next.titleOverride &&
				samePartRun(left.parts, next.parts)
			);
		}
		case 'assistant-approvals':
			return true;
		case 'assistant-status': {
			const next = right as Extract<ThreadRow, { kind: 'assistant-status' }>;
			// The status row renders its `part` (or the generic loading copy), never
			// the message itself, so the per-delta `Message` replacement of a live
			// turn must not invalidate it.
			return (
				left.message.id === next.message.id &&
				left.variant === next.variant &&
				left.part === next.part &&
				left.showLine === next.showLine &&
				left.isFirstPart === next.isFirstPart
			);
		}
		case 'assistant-error': {
			const next = right as Extract<ThreadRow, { kind: 'assistant-error' }>;
			return left.error === next.error;
		}
	}
}

/** True when two row lists are element-wise identical (identity comparison). */
export function sameThreadRows(
	left: readonly ThreadRow[],
	right: readonly ThreadRow[],
) {
	if (left === right) return true;
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

/**
 * Flattens the visible thread into stable list rows. Row keys are derived from
 * message/part ids so LegendList keeps measurements across rebuilds, and every
 * persisted part maps to exactly one row.
 */
export function buildThreadRows({
	messages,
	sessionId,
	compact,
	currentMessageId,
	queueLength,
	queuedMessageIds,
	cache,
}: BuildThreadRowsOptions): ThreadRowsResult {
	const rowIdentityCache = cache ?? defaultRowIdentityCache;
	const rows: ThreadRow[] = [];
	const rowIndexByMessageIndex: number[] = [];
	const seenKeys = new Set<string>();

	// Rows for the message being built. `endsTurn` is only known once the turn
	// is complete, so rows are staged here and reconciled with the identity
	// cache in one pass — patching a cached row afterwards would defeat reuse.
	let staged: ThreadRow[] = [];
	const push = (row: ThreadRow) => {
		staged.push(row);
	};
	const flushStaged = () => {
		if (staged.length === 0) return;
		const lastIndex = staged.length - 1;
		for (const [index, row] of staged.entries()) {
			const candidate =
				index === lastIndex && !row.endsTurn
					? ({ ...row, endsTurn: true } as ThreadRow)
					: row;
			const previous = rowIdentityCache.get(candidate.key);
			const next =
				previous && sameRow(previous, candidate) ? previous : candidate;
			rowIdentityCache.set(candidate.key, next);
			seenKeys.add(candidate.key);
			rows.push(next);
		}
		staged = [];
	};

	messages.forEach((message, messageIndex) => {
		const startRowIndex = rows.length;
		rowIndexByMessageIndex.push(startRowIndex);
		const isLastMessage = messageIndex === messages.length - 1;
		const nextMessage = messages[messageIndex + 1];
		const previousMessage = messages[messageIndex - 1];
		const nextAssistantMessage =
			nextMessage && nextMessage.role === 'assistant' ? nextMessage : undefined;

		if (message.role === 'user') {
			if (message.optimistic === 'queued') return;
			push({
				kind: 'user',
				key: `u:${message.id}`,
				messageId: message.id,
				endsTurn: true,
				message,
				nextAssistantMessageId: nextAssistantMessage?.id,
			});
			flushStaged();
			return;
		}

		// Queued turns surface in the queue bar, never inline in the thread.
		if (message.role !== 'assistant' || queuedMessageIds.has(message.id))
			return;

		const hasQueuedOrRunningLaterTurn = Boolean(
			currentMessageId && currentMessageId !== message.id,
		);
		const canRetry =
			isLastMessage && !hasQueuedOrRunningLaterTurn && queueLength === 0;
		const previousUserMessage =
			previousMessage?.role === 'user' ? previousMessage : undefined;
		const isCompactCommandResult = isCompactSlashCommand(
			getUserMessageText(previousUserMessage),
		);
		const showHeader =
			!isCompactCommandResult &&
			(!previousMessage || previousMessage.role !== 'assistant');
		const hasNextAssistantMessage = Boolean(nextAssistantMessage);

		const turn = getAssistantTurn(message, { compact });

		if (showHeader) {
			push({
				kind: 'assistant-header',
				key: `h:${message.id}`,
				messageId: message.id,
				endsTurn: false,
				message,
			});
		}

		const parts = turn.parts;
		const hasTrailingChrome =
			hasNextAssistantMessage ||
			turn.shouldShowStatusLineToolCall ||
			turn.shouldShowProgressUpdate ||
			turn.shouldShowLoadingFallback;

		// A live action tool renders its own streaming box from an ephemeral
		// (never persisted) placeholder. Once the persisted result lands the
		// placeholder is redundant, so the client-only row is dropped instead of
		// the persisted one: every persisted part keeps exactly one row.
		const isRedundantPlaceholder = (part: MessagePart) =>
			Boolean(
				part.ephemeral &&
					part.toolCallId &&
					turn.completedActionToolCallIds.has(part.toolCallId),
			);

		// The timeline connector must stop at the last part that actually draws
		// something, otherwise it would trail off into suppressed placeholders.
		let lastVisiblePartIndex = -1;
		parts.forEach((part, index) => {
			if (isRedundantPlaceholder(part)) return;
			if (getPartPresentation(part, turn) === 'visible') {
				lastVisiblePartIndex = index;
			}
		});

		/** Staged index of the last row that actually draws something. */
		let lastDrawnStagedIndex = -1;

		const pushPartRow = (
			part: MessagePart,
			index: number,
			presentation: PartPresentation,
		) => {
			const isFinishTool =
				part.type === 'tool_result' && part.toolName === 'finish';
			const isSuppressed = presentation === 'suppressed';
			// A suppressed row draws no timeline dot, so it must not draw the
			// connector either — otherwise the line would float in empty space.
			const showLine =
				!isFinishTool &&
				!isSuppressed &&
				(index < lastVisiblePartIndex || hasTrailingChrome);
			if (!isSuppressed) lastDrawnStagedIndex = staged.length;

			push({
				kind: 'assistant-item',
				key: `i:${part.id}`,
				messageId: message.id,
				endsTurn: false,
				part,
				variant: isSuppressed
					? 'suppressed'
					: shouldRenderCompactionSummaryBox({
								compact,
								part,
								previousUserMessage,
							})
						? 'compaction'
						: isActionToolPart(part)
							? 'action'
							: 'part',
				showLine,
				isFirstPart: index === turn.firstVisiblePartIndex && !showHeader,
				isLiveToolCall: isLiveToolCallPart(part, turn),
				isLastMessage,
				canRetry,
			});
		};

		// Compact threads present a *contiguous run* of exploratory parts as one
		// bordered, height-constrained activity box, so the run is buffered here
		// and flushed as a single row.
		let activityRun: { part: MessagePart; index: number }[] = [];
		let pendingGroupTitle: string | undefined;

		const flushActivityRun = (nextTitle?: string) => {
			if (activityRun.length === 0) {
				if (nextTitle) pendingGroupTitle = nextTitle;
				return;
			}
			const run = activityRun;
			const titleOverride = pendingGroupTitle;
			activityRun = [];
			pendingGroupTitle = nextTitle;

			const runParts = run.map((item) => item.part);
			const entries = buildCompactActivityEntries(runParts);
			if (entries.length === 0) {
				// Nothing summarizable in the run: fall back to ordinary rows so
				// no part loses its place in the timeline.
				for (const item of run) pushPartRow(item.part, item.index, 'visible');
				return;
			}

			lastDrawnStagedIndex = staged.length;
			push({
				kind: 'assistant-compact-group',
				key: `cg:${run[0].part.id}`,
				messageId: message.id,
				endsTurn: false,
				parts: runParts,
				entries,
				titleOverride,
				// Reconciled below: only the turn's final box stays expanded, and
				// only while the turn is still streaming.
				collapsed: true,
				showLine:
					run[run.length - 1].index < lastVisiblePartIndex || hasTrailingChrome,
			});
		};

		parts.forEach((part, index) => {
			if (isRedundantPlaceholder(part)) return;

			// Membership is decided before visibility: a resolved tool *call* is
			// suppressed on its own, but inside a run it is part of the same
			// exploration the box summarizes (the entry builder de-duplicates it
			// against its result), so it must not split the run in two.
			if (turn.shouldCompactActivity && isCompactActivityPart(part)) {
				activityRun.push({ part, index });
				return;
			}

			const presentation = getPartPresentation(part, turn);
			if (presentation === 'suppressed') {
				// Suppressed parts (status tools, todo results, empty text) close
				// the current run; a progress update also titles the next one.
				flushActivityRun(getProgressUpdateMessage(part));
				pushPartRow(part, index, presentation);
				return;
			}

			flushActivityRun();
			pushPartRow(part, index, presentation);
		});
		flushActivityRun();

		// Exactly one activity box is ever expanded: the turn's last drawn row,
		// and only while the turn is still streaming. Everything above it shows
		// its one-line summary, which is what keeps a compact turn short.
		if (message.status === 'pending' && lastDrawnStagedIndex >= 0) {
			const lastDrawn = staged[lastDrawnStagedIndex];
			if (lastDrawn.kind === 'assistant-compact-group') {
				staged[lastDrawnStagedIndex] = { ...lastDrawn, collapsed: false };
			}
		}

		if (message.status === 'pending') {
			push({
				kind: 'assistant-approvals',
				key: `ap:${message.id}`,
				messageId: message.id,
				endsTurn: false,
			});
		}

		const statusVariant = turn.shouldShowStatusLineToolCall
			? 'tool'
			: turn.shouldShowProgressUpdate
				? 'progress'
				: turn.shouldShowLoadingFallback
					? 'loading'
					: null;
		if (statusVariant) {
			push({
				kind: 'assistant-status',
				key: `st:${message.id}`,
				messageId: message.id,
				endsTurn: false,
				message,
				variant: statusVariant,
				part:
					statusVariant === 'tool'
						? turn.latestStatusLineToolCallPart
						: statusVariant === 'progress'
							? turn.latestProgressUpdatePart
							: null,
				showLine: hasNextAssistantMessage,
				isFirstPart: !turn.hasVisibleNonProgressParts && !showHeader,
			});
		}

		if (turn.shouldShowErrorFallback && message.error) {
			push({
				kind: 'assistant-error',
				key: `er:${message.id}`,
				messageId: message.id,
				endsTurn: false,
				error: message.error,
			});
		}

		if (shouldRenderTurnFooter(message, sessionId, hasNextAssistantMessage)) {
			push({
				kind: 'assistant-footer',
				key: `ft:${message.id}`,
				messageId: message.id,
				endsTurn: false,
				message,
			});
		}

		const hadRows = staged.length > 0;
		flushStaged();
		if (!hadRows) {
			// A turn with nothing to show keeps its slot out of the row list.
			rowIndexByMessageIndex[messageIndex] = Math.max(0, startRowIndex - 1);
		}
	});

	// Bound the cache to the rows that still exist so switching sessions or
	// trimming a thread cannot leak entries.
	if (rowIdentityCache.size > seenKeys.size) {
		for (const key of rowIdentityCache.keys()) {
			if (!seenKeys.has(key)) rowIdentityCache.delete(key);
		}
	}

	return { rows, rowIndexByMessageIndex };
}

/** Test seam: clears the shared fallback row identity cache. */
export function resetThreadRowCache() {
	defaultRowIdentityCache.clear();
}
