import type { MessagePart } from '../../types/api';
import {
	type AssistantRenderItem,
	isStatusLineTool,
} from './assistantTurnModel';
import {
	getPartPresentation,
	hasRenderableText,
	isLiveToolCallPart,
	isTodoTool,
	type PartPresentationContext,
} from './partVisibility';

export interface TurnWorkContext extends PartPresentationContext {
	/**
	 * Action-tool call ids that already have a persisted result. Their
	 * ephemeral placeholder is not real work.
	 */
	completedActionToolCallIds: ReadonlySet<string>;
}

/**
 * True for a part that is agent work (tools, reasoning) rather than the
 * turn's closing answer. Status/todo/finish parts are excluded because they
 * already have another home in the UI.
 */
export function isCollapsibleWorkPart(
	part: MessagePart,
	context: TurnWorkContext,
): boolean {
	if (
		part.ephemeral &&
		part.toolCallId &&
		context.completedActionToolCallIds.has(part.toolCallId)
	) {
		return false;
	}

	if (part.type === 'reasoning') {
		return hasRenderableText(part);
	}

	if (part.type !== 'tool_call' && part.type !== 'tool_result') {
		return false;
	}

	if (part.toolName === 'finish') return false;
	if (isStatusLineTool(part.toolName) || isTodoTool(part.toolName)) {
		return false;
	}

	// A resolved tool *call* is already suppressed; the matching result is
	// the work the reader would expand to see.
	if (part.type === 'tool_call' && !isLiveToolCallPart(part, context)) {
		return false;
	}

	return true;
}

/** Index of the first part that belongs to the closing answer (or `parts.length`). */
export function getTrailingAnswerStartIndex(
	parts: readonly MessagePart[],
	context: TurnWorkContext,
): number {
	let lastWorkIndex = -1;
	for (let index = 0; index < parts.length; index++) {
		if (isCollapsibleWorkPart(parts[index], context)) {
			lastWorkIndex = index;
		}
	}
	return lastWorkIndex + 1;
}

export function hasCollapsibleWork(
	parts: readonly MessagePart[],
	context: TurnWorkContext,
): boolean {
	return parts.some((part) => isCollapsibleWorkPart(part, context));
}

/**
 * When an older turn is collapsed, hide work plus any commentary that came
 * before the closing answer. Images, files, and errors stay visible.
 */
export function shouldHidePartWhenWorkCollapsed(
	part: MessagePart,
	index: number,
	answerStart: number,
	context: TurnWorkContext,
): boolean {
	if (isCollapsibleWorkPart(part, context)) return true;
	if (getPartPresentation(part, context) === 'suppressed') return true;
	if (index >= answerStart) return false;
	return part.type === 'text' || part.type === 'reasoning';
}

export function isWorkRenderItem(
	item: AssistantRenderItem,
	context: TurnWorkContext,
): boolean {
	if (item.kind === 'group') return true;
	return isCollapsibleWorkPart(item.part, context);
}

/** Index of the first render item that belongs to the closing answer. */
export function getTrailingAnswerRenderStart(
	items: readonly AssistantRenderItem[],
	context: TurnWorkContext,
): number {
	let lastWorkIndex = -1;
	for (let index = 0; index < items.length; index++) {
		if (isWorkRenderItem(items[index], context)) {
			lastWorkIndex = index;
		}
	}
	return lastWorkIndex + 1;
}
