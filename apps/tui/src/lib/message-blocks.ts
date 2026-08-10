import type { MessagePart } from '../types.ts';

const SKIP_TOOLS = new Set(['finish', 'progress_update']);

export type MessageBlock =
	| { key: string; kind: 'part'; part: MessagePart }
	| { key: string; kind: 'reasoning'; parts: MessagePart[] }
	| { key: string; kind: 'tools'; parts: MessagePart[] }
	| { key: string; kind: 'todos'; part: MessagePart };

export function extractPartText(part: MessagePart): string {
	if (
		part.contentJson &&
		typeof part.contentJson === 'object' &&
		!Array.isArray(part.contentJson) &&
		'text' in part.contentJson
	) {
		return String(part.contentJson.text ?? '');
	}
	if (typeof part.content === 'string') {
		try {
			const parsed = JSON.parse(part.content);
			if (parsed && typeof parsed.text === 'string') return parsed.text;
		} catch {}
		return part.content;
	}
	return '';
}

/** Estimates terminal rows used by wrapped text, capped for bounded panels. */
export function estimateWrappedLineCount(
	text: string,
	width: number,
	maxLines = Number.POSITIVE_INFINITY,
): number {
	const safeWidth = Math.max(1, width);
	let lines = 0;
	for (const line of text.replace(/\r/g, '').split('\n')) {
		lines += Math.max(1, Math.ceil(line.length / safeWidth));
		if (lines >= maxLines) return maxLines;
	}
	return Math.max(1, lines);
}

function isToolPart(part: MessagePart): boolean {
	return part.type === 'tool_call' || part.type === 'tool_result';
}

export function messagePartKey(part: MessagePart): string {
	return isToolPart(part) && part.toolCallId
		? `tool-${part.toolCallId}`
		: part.id;
}

function isTodoTool(toolName: string | null): boolean {
	return toolName === 'update_todos' || toolName === 'update_plan';
}

/**
 * Builds compact transcript blocks, merging adjacent tools and adjacent
 * reasoning parts while retaining the newest todo snapshot only.
 */
export function buildMessageBlocks(parts: MessagePart[]): MessageBlock[] {
	let lastTodoId: string | null = null;
	for (const part of parts) {
		if (isToolPart(part) && isTodoTool(part.toolName)) lastTodoId = part.id;
	}

	const blocks: MessageBlock[] = [];
	for (const part of parts) {
		if (isToolPart(part)) {
			const toolName = part.toolName || '';
			if (SKIP_TOOLS.has(toolName)) continue;
			if (isTodoTool(toolName)) {
				if (part.id !== lastTodoId) continue;
				blocks.push({ key: `todos-${part.id}`, kind: 'todos', part });
				continue;
			}
			const previous = blocks[blocks.length - 1];
			if (previous?.kind === 'tools') previous.parts.push(part);
			else
				blocks.push({
					key: messagePartKey(part),
					kind: 'tools',
					parts: [part],
				});
			continue;
		}

		if (part.type === 'reasoning') {
			if (!extractPartText(part).trim()) continue;
			const previous = blocks[blocks.length - 1];
			if (previous?.kind === 'reasoning') previous.parts.push(part);
			else blocks.push({ key: part.id, kind: 'reasoning', parts: [part] });
			continue;
		}

		if (part.type === 'text') {
			if (!extractPartText(part).trim()) continue;
			blocks.push({ key: part.id, kind: 'part', part });
		}
	}
	return blocks;
}
