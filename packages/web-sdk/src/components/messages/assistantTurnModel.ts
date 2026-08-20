import type { Message, MessagePart } from '../../types/api';
import {
	type CompactActivityEntry,
	buildCompactActivityEntries,
	isCompactActivityPart,
} from './compactActivity';

export const STATUS_LINE_TOOL_NAMES = new Set([
	'progress_update',
	'update_status',
	'update_todos',
]);

export const AUTO_COMPACT_COMPLETED_PART_THRESHOLD = 60;
export const PART_WINDOW_RENDER_THRESHOLD = 90;
export const PART_WINDOW_HEAD_COUNT = 20;
export const PART_WINDOW_TAIL_COUNT = 48;

export const ACTION_TOOL_NAMES = [
	'shell',
	'bash',
	'edit',
	'multiedit',
	'write',
	'copy_into',
	'apply_patch',
	'terminal',
];

const LOADING_MESSAGES = [
	'Generating...',
	'Cooking up something...',
	'Thinking...',
	'Processing...',
	'Working on it...',
	'Crafting response...',
	'Brewing magic...',
	'Computing...',
];

/** Stable per-message loading copy so the label does not flicker on rerender. */
export function getLoadingMessage(messageId: string) {
	const hash = messageId
		.split('')
		.reduce((acc, char) => acc + char.charCodeAt(0), 0);
	return LOADING_MESSAGES[hash % LOADING_MESSAGES.length];
}

export function isStatusLineTool(toolName: string | null | undefined) {
	return STATUS_LINE_TOOL_NAMES.has(toolName || '');
}

export function isActionToolPart(part: MessagePart) {
	return Boolean(
		part.ephemeral &&
			(part.type === 'tool_call' || part.type === 'tool_result') &&
			ACTION_TOOL_NAMES.includes(part.toolName || ''),
	);
}

function compareMessageParts(a: MessagePart, b: MessagePart) {
	const indexDiff = (a.index ?? 0) - (b.index ?? 0);
	if (indexDiff !== 0) return indexDiff;
	const stepDiff = (a.stepIndex ?? 0) - (b.stepIndex ?? 0);
	if (stepDiff !== 0) return stepDiff;
	return (a.startedAt ?? 0) - (b.startedAt ?? 0);
}

function areMessagePartsOrdered(parts: MessagePart[]) {
	for (let index = 1; index < parts.length; index++) {
		if (compareMessageParts(parts[index - 1], parts[index]) > 0) {
			return false;
		}
	}
	return true;
}

/** Parts in render order; tool results can arrive out of order while streaming. */
export function getOrderedMessageParts(message: Message): MessagePart[] {
	const rawParts = message.parts || [];
	return areMessagePartsOrdered(rawParts)
		? rawParts
		: [...rawParts].sort(compareMessageParts);
}

export type AssistantRenderItem =
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

export interface VisibleAssistantRenderItem {
	item: AssistantRenderItem;
	renderIndex: number;
}

export interface PreloadedContextSummary {
	files: Array<{ path: string; lineRange?: string }>;
	totalBytes?: number;
	preloadDurationMs?: number;
	deduplicatedFileCount?: number;
}

function parsePartPayload(part: MessagePart): Record<string, unknown> | null {
	if (part.contentJson && typeof part.contentJson === 'object') {
		return part.contentJson;
	}
	try {
		const parsed = JSON.parse(part.content || '{}');
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function isPreloadedContextPart(part: MessagePart): boolean {
	const payload = parsePartPayload(part);
	return payload?.synthetic === true && payload.origin === 'message_context';
}

export function getPreloadedContextSummary(
	parts: MessagePart[],
): PreloadedContextSummary | null {
	const resultParts = parts.filter(
		(part) => part.type === 'tool_result' && isPreloadedContextPart(part),
	);
	if (resultParts.length === 0) return null;
	const files = resultParts.flatMap((part) => {
		const payload = parsePartPayload(part);
		const args = payload?.args;
		if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
		const input = args as Record<string, unknown>;
		if (typeof input.path !== 'string') return [];
		const startLine =
			typeof input.startLine === 'number' ? input.startLine : undefined;
		const endLine =
			typeof input.endLine === 'number' ? input.endLine : undefined;
		const maxLines =
			typeof input.maxLines === 'number' ? input.maxLines : undefined;
		const lineRange = startLine
			? endLine
				? `${startLine}-${endLine}`
				: `${startLine}+${maxLines ?? 1}`
			: undefined;
		return [{ path: input.path, lineRange }];
	});
	const payload = parsePartPayload(resultParts[0]);
	const context =
		payload?.context &&
		typeof payload.context === 'object' &&
		!Array.isArray(payload.context)
			? (payload.context as Record<string, unknown>)
			: null;
	return {
		files,
		totalBytes:
			typeof context?.totalBytes === 'number' ? context.totalBytes : undefined,
		preloadDurationMs:
			typeof context?.preloadDurationMs === 'number'
				? context.preloadDurationMs
				: undefined,
		deduplicatedFileCount:
			typeof context?.deduplicatedFileCount === 'number'
				? context.deduplicatedFileCount
				: undefined,
	};
}

export function getRenderItemKey(item: AssistantRenderItem) {
	return item.kind === 'group' ? item.id : item.part.id;
}

/** True for the `progress_update` tool, whose text titles the next activity group. */
export function isProgressUpdatePart(part: MessagePart) {
	return (
		(part.type === 'tool_result' || part.type === 'tool_call') &&
		part.toolName === 'progress_update'
	);
}

/**
 * Text of a `progress_update` part, or `undefined` for any other part. The
 * compact renderer uses it as the title of the activity group that follows it.
 */
export function getProgressUpdateMessage(
	part: MessagePart,
): string | undefined {
	if (!isProgressUpdatePart(part)) return undefined;
	const payload =
		part.contentJson && typeof part.contentJson === 'object'
			? part.contentJson
			: null;
	if (!payload) return undefined;
	const bucket =
		(payload as Record<string, unknown>).args ??
		(payload as Record<string, unknown>).result;
	if (!bucket || typeof bucket !== 'object') return undefined;
	const text = (bucket as Record<string, unknown>).message;
	return typeof text === 'string' && text.trim() ? text.trim() : undefined;
}

export function buildAssistantRenderItems(
	parts: MessagePart[],
	shouldCompactActivity: boolean,
): AssistantRenderItem[] {
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
		if (isProgressUpdatePart(part)) {
			const message = getProgressUpdateMessage(part);
			if (message) {
				flushCompactBuffer(message);
			}
			continue;
		}

		if (isStatusLineTool(part.toolName)) {
			flushCompactBuffer();
			continue;
		}

		if (shouldCompactActivity && isCompactActivityPart(part)) {
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
}

/**
 * Windows very long turns: the head and tail stay rendered and the middle
 * collapses behind a "show all" affordance until the user expands it.
 */
export function getVisibleRenderItems(
	renderItems: AssistantRenderItem[],
	showAllParts: boolean,
	messageStatus: Message['status'],
) {
	if (
		showAllParts ||
		messageStatus === 'pending' ||
		renderItems.length <= PART_WINDOW_RENDER_THRESHOLD
	) {
		return {
			visibleRenderItems: renderItems.map((item, renderIndex) => ({
				item,
				renderIndex,
			})),
			omittedRenderItemCount: 0,
		};
	}

	const tailStart = Math.max(
		PART_WINDOW_HEAD_COUNT,
		renderItems.length - PART_WINDOW_TAIL_COUNT,
	);
	const visibleRenderItems: VisibleAssistantRenderItem[] = [];
	for (
		let renderIndex = 0;
		renderIndex < PART_WINDOW_HEAD_COUNT;
		renderIndex++
	) {
		const item = renderItems[renderIndex];
		if (item) visibleRenderItems.push({ item, renderIndex });
	}
	for (
		let renderIndex = tailStart;
		renderIndex < renderItems.length;
		renderIndex++
	) {
		const item = renderItems[renderIndex];
		if (item) visibleRenderItems.push({ item, renderIndex });
	}

	return {
		visibleRenderItems,
		omittedRenderItemCount: Math.max(0, tailStart - PART_WINDOW_HEAD_COUNT),
	};
}

export interface AssistantTurnOptions {
	compact?: boolean;
	isQueued?: boolean;
	showAllParts?: boolean;
	/**
	 * Keeps a turn in its expanded per-part representation even after it
	 * completes past the auto-compact threshold. The thread sets this for
	 * turns it already rendered expanded while they streamed: swapping the
	 * whole turn to compact groups at the pending→complete instant would
	 * remove every in-view row key at once, which the reader experiences as
	 * the viewport jumping. History turns (first seen complete) still
	 * auto-compact.
	 */
	suppressAutoCompact?: boolean;
}

interface CachedAssistantTurn {
	signature: string;
	model: AssistantTurnModel;
}

const assistantTurnCache = new WeakMap<Message, CachedAssistantTurn>();

/**
 * Memoized `deriveAssistantTurn` keyed on message identity. Messages are
 * replaced (not mutated) on every stream update, so untouched turns are
 * re-derived zero times while the thread rebuilds its rows.
 */
export function getAssistantTurn(
	message: Message,
	options: AssistantTurnOptions,
): AssistantTurnModel {
	const signature = `${options.compact ? 1 : 0}:${options.isQueued ? 1 : 0}:${
		options.showAllParts ? 1 : 0
	}:${options.suppressAutoCompact ? 1 : 0}`;
	const cached = assistantTurnCache.get(message);
	if (cached && cached.signature === signature) return cached.model;
	const model = deriveAssistantTurn(message, options);
	assistantTurnCache.set(message, { signature, model });
	return model;
}

export interface AssistantTurnModel {
	parts: MessagePart[];
	preloadedContext: PreloadedContextSummary | null;
	renderItems: AssistantRenderItem[];
	visibleRenderItems: VisibleAssistantRenderItem[];
	omittedRenderItemCount: number;
	autoCompactActivity: boolean;
	shouldCompactActivity: boolean;
	liveActionToolCallIds: Set<string>;
	/**
	 * Action-tool call ids that already have a persisted `tool_result`. Their
	 * ephemeral (client-only) placeholder is redundant and is dropped so the
	 * persisted part keeps the row.
	 */
	completedActionToolCallIds: Set<string>;
	/**
	 * Every tool call id in this turn that already has a persisted
	 * `tool_result`. A call row keeps its live box until this contains its id,
	 * which makes the row's height independent of how many parts follow it.
	 */
	resolvedToolCallIds: Set<string>;
	firstVisiblePartIndex: number;
	hasVisibleNonProgressParts: boolean;
	latestProgressUpdatePart: MessagePart | null;
	latestStatusLineToolCallPart: MessagePart | null;
	shouldShowStatusLineToolCall: boolean;
	shouldShowProgressUpdate: boolean;
	shouldShowLoadingFallback: boolean;
	shouldShowErrorFallback: boolean;
}

/**
 * Derives everything needed to render one assistant turn. Shared by the
 * grouped renderer and the flattened thread rows so both stay in sync.
 */
export function deriveAssistantTurn(
	message: Message,
	options: AssistantTurnOptions,
): AssistantTurnModel {
	const { compact, isQueued, showAllParts = false } = options;
	const parts = getOrderedMessageParts(message);
	const preloadedContext = getPreloadedContextSummary(parts);
	const renderableParts = parts.filter((part) => !isPreloadedContextPart(part));
	const autoCompactActivity =
		!options.suppressAutoCompact &&
		message.status !== 'pending' &&
		renderableParts.length >= AUTO_COMPACT_COMPLETED_PART_THRESHOLD;
	const shouldCompactActivity = Boolean(compact || autoCompactActivity);

	const hasFinish = renderableParts.some((part) => part.toolName === 'finish');
	const latestProgressUpdateIndex = renderableParts.reduce(
		(lastIndex, part, index) =>
			part.type === 'tool_result' && part.toolName === 'progress_update'
				? index
				: lastIndex,
		-1,
	);
	const latestProgressUpdatePart =
		latestProgressUpdateIndex >= 0
			? renderableParts[latestProgressUpdateIndex]
			: null;
	const resolvedToolCallIds = new Set(
		renderableParts
			.filter((part) => part.type === 'tool_result' && part.toolCallId)
			.map((part) => part.toolCallId)
			.filter((callId): callId is string => Boolean(callId)),
	);
	const latestStatusLineToolCallIndex = renderableParts.reduce(
		(lastIndex, part, index) =>
			part.type === 'tool_call' &&
			isStatusLineTool(part.toolName) &&
			(!part.toolCallId || !resolvedToolCallIds.has(part.toolCallId))
				? index
				: lastIndex,
		-1,
	);
	const latestStatusLineToolCallPart =
		latestStatusLineToolCallIndex >= 0
			? renderableParts[latestStatusLineToolCallIndex]
			: null;
	const liveActionToolCallIds = new Set(
		renderableParts
			.filter(
				(part) =>
					part.ephemeral && ACTION_TOOL_NAMES.includes(part.toolName || ''),
			)
			.map((part) => part.toolCallId)
			.filter((callId): callId is string => Boolean(callId)),
	);
	const completedActionToolCallIds = new Set(
		renderableParts
			.filter(
				(part) =>
					!part.ephemeral &&
					part.type === 'tool_result' &&
					ACTION_TOOL_NAMES.includes(part.toolName || ''),
			)
			.map((part) => part.toolCallId)
			.filter((callId): callId is string => Boolean(callId)),
	);

	const renderItems = buildAssistantRenderItems(
		renderableParts,
		shouldCompactActivity,
	);
	const { visibleRenderItems, omittedRenderItemCount } = getVisibleRenderItems(
		renderItems,
		showAllParts,
		message.status,
	);
	const hasVisibleNonProgressParts = renderItems.length > 0;
	const firstVisiblePartIndex = renderableParts.findIndex(
		(part) => !isStatusLineTool(part.toolName),
	);

	const shouldShowStatusLineToolCall =
		message.status === 'pending' &&
		!hasFinish &&
		Boolean(latestStatusLineToolCallPart);
	const shouldShowProgressUpdate =
		message.status === 'pending' &&
		!hasFinish &&
		!latestStatusLineToolCallPart &&
		Boolean(latestProgressUpdatePart);
	const shouldShowLoadingFallback =
		message.status === 'pending' &&
		!hasFinish &&
		!latestStatusLineToolCallPart &&
		!latestProgressUpdatePart &&
		!isQueued;
	const shouldShowErrorFallback = Boolean(
		message.status === 'error' && !hasVisibleNonProgressParts && message.error,
	);

	return {
		parts: renderableParts,
		preloadedContext,
		renderItems,
		visibleRenderItems,
		omittedRenderItemCount,
		autoCompactActivity,
		shouldCompactActivity,
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
	};
}
