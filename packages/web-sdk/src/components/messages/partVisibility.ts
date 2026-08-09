import type { MessagePart } from '../../types/api';
import { isStatusLineTool } from './assistantTurnModel';

/**
 * Decides, for a single persisted message part, whether the timeline shows its
 * content or an inert placeholder.
 *
 * Every persisted part owns exactly one list row. Some parts have nothing to
 * show *in the timeline* — their content is surfaced by the live status row or
 * the todo panel, or they are simply empty. Those rows used to render `null`,
 * which collapsed them to zero pixels and, worse, flipped a tool call from a
 * full-height box to nothing the moment another part streamed in. This module
 * makes that decision explicit, positional-free and unit testable:
 *
 *  - suppression depends only on the part itself and on whether its tool call
 *    has been resolved, never on the part's index in the turn, so a row's
 *    height changes at most once and only when its own data changes;
 *  - a suppressed part still yields a row, so the part → row mapping stays 1:1
 *    and LegendList keeps a stable, measurable item for it.
 */
export type PartPresentation = 'visible' | 'suppressed';

export interface PartPresentationContext {
	/**
	 * Tool call ids in this turn that already have a persisted `tool_result`.
	 * A call is interesting only until its result lands.
	 */
	resolvedToolCallIds: ReadonlySet<string>;
}

/**
 * Tool results whose content is rendered by the todo panel rather than the
 * thread, so their timeline row has nothing to show.
 */
export function isTodoTool(toolName: string | null | undefined): boolean {
	return (
		toolName === 'update_todos' ||
		toolName === 'update_plan' ||
		toolName === 'UpdateTodos' ||
		toolName === 'UpdatePlan'
	);
}

/** Text payload of a text/reasoning part, using the renderer's own precedence. */
function getPartText(part: MessagePart): string {
	const data = part.contentJson || part.content;
	if (data && typeof data === 'object' && 'text' in data) {
		const text = (data as { text?: unknown }).text;
		return typeof text === 'string' ? text : String(text ?? '');
	}
	return typeof data === 'string' ? data : '';
}

/** True when a text/reasoning part carries something worth rendering. */
export function hasRenderableText(part: MessagePart): boolean {
	return getPartText(part).trim().length > 0;
}

/**
 * True when this tool call still renders its live "running…" box. Derived from
 * the call's own result rather than from its position in the turn, so appending
 * unrelated parts can never change it.
 */
export function isLiveToolCallPart(
	part: MessagePart,
	{ resolvedToolCallIds }: PartPresentationContext,
): boolean {
	if (part.type !== 'tool_call') return false;
	// Status/progress tools are pinned into the dedicated live status row.
	if (isStatusLineTool(part.toolName)) return false;
	if (part.toolCallId && resolvedToolCallIds.has(part.toolCallId)) return false;
	return true;
}

/**
 * Whether a part renders its content in the timeline. Mirrors exactly the cases
 * `MessagePartItem` declines to render, so moving the decision here changes no
 * visuals — it only replaces a `null` return with a measurable placeholder row.
 */
export function getPartPresentation(
	part: MessagePart,
	context: PartPresentationContext,
): PartPresentation {
	switch (part.type) {
		case 'tool_call':
			return isLiveToolCallPart(part, context) ? 'visible' : 'suppressed';
		case 'tool_result':
			// Progress updates only ever appear in the live status row, and todo
			// results are owned by the todo panel.
			if (isStatusLineTool(part.toolName) || isTodoTool(part.toolName)) {
				return 'suppressed';
			}
			return 'visible';
		case 'text':
		case 'reasoning':
			return hasRenderableText(part) ? 'visible' : 'suppressed';
		default:
			// file / image / error / anything the server adds later: always shown,
			// so a new part type can never silently collapse to a zero-height row.
			return 'visible';
	}
}
