import type { getDb } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import type { RunOpts } from '../../session/queue.ts';
import { markEmptyAssistantResponseAsError } from '../../stream/finish-handler.ts';
import type { RunnerToolObserverState } from './runner-tool-observer.ts';

const NON_OUTPUT_PART_TYPES = new Set([
	'error',
	'diagnostic',
	'memory_context',
	'reasoning',
]);
const SYNTHETIC_TOOL_NAMES = new Set(['memory_context']);

type PartRow = {
	type: string;
	content: string | null;
	toolName: string | null;
};

function parseContent(content: string | null): Record<string, unknown> {
	if (!content) return {};
	try {
		const parsed = JSON.parse(content) as unknown;
		return parsed && typeof parsed === 'object'
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/**
 * Meaningful model output: non-empty text, real (non-synthetic) tool
 * activity, or model artifacts such as images/files. Memory context,
 * diagnostics, errors, and reasoning alone do not count.
 */
export function isMeaningfulAssistantPart(part: PartRow): boolean {
	if (NON_OUTPUT_PART_TYPES.has(part.type)) return false;
	if (part.toolName && SYNTHETIC_TOOL_NAMES.has(part.toolName)) return false;
	const content = parseContent(part.content);
	if (part.type === 'text') {
		return typeof content.text === 'string' && content.text.trim().length > 0;
	}
	if (part.type === 'tool_call' || part.type === 'tool_result') {
		if (content.synthetic === true) return false;
		const name = typeof content.name === 'string' ? content.name : undefined;
		return !(name && SYNTHETIC_TOOL_NAMES.has(name));
	}
	return true;
}

export async function hasMeaningfulAssistantOutput(
	db: Awaited<ReturnType<typeof getDb>>,
	messageId: string,
): Promise<boolean> {
	const parts = await db
		.select({
			type: messageParts.type,
			content: messageParts.content,
			toolName: messageParts.toolName,
		})
		.from(messageParts)
		.where(eq(messageParts.messageId, messageId));
	return parts.some(isMeaningfulAssistantPart);
}

export async function markEmptyResponseAfterFinalAttempt(args: {
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	finishReason: string | undefined;
	rawFinishReason: string | undefined;
	toolObserver: RunnerToolObserverState;
}): Promise<boolean> {
	if (args.finishReason === 'error') return false;
	if (args.opts.abortSignal?.aborted) return false;

	if (await hasMeaningfulAssistantOutput(args.db, args.opts.assistantMessageId))
		return false;

	// If this run observed tool activity, do not synthesize an empty-response
	// error here. Tool-only or retried turns can legitimately have no final text
	// while still doing useful work, and retry/continuation flow owns recovery.
	if (args.toolObserver.toolActivityObserved) return false;

	await markEmptyAssistantResponseAsError({
		opts: args.opts,
		db: args.db,
		fin: {
			finishReason: args.finishReason,
			rawFinishReason: args.rawFinishReason,
		},
	});
	return true;
}
