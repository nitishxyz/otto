import type { getDb } from '@ottocode/database';
import { estimateTokens, PRUNE_PROTECT } from './compaction-limits.ts';
import { applyPartCompaction } from './compaction-mark.ts';
import {
	loadSessionMessages,
	loadSessionPartsByMessageId,
} from './session-order.ts';

const PROTECTED_TOOLS = ['skill'];

/**
 * Hides old tool results (outside the last two user turns) from model
 * history. Pruned results are rendered as "omitted by compaction", never as
 * failures. Returns the number of parts confirmed updated; persistence
 * failures propagate to the caller.
 */
export async function pruneSession(
	db: Awaited<ReturnType<typeof getDb>>,
	sessionId: string,
): Promise<{ pruned: number; saved: number }> {
	const [allMessages, partsByMessageId] = await Promise.all([
		loadSessionMessages(db, sessionId),
		loadSessionPartsByMessageId(db, sessionId),
	]);

	let totalTokens = 0;
	let prunedTokens = 0;
	const toPrune: string[] = [];
	let turns = 0;

	for (const msg of allMessages.toReversed()) {
		if (msg.role === 'user') turns++;
		if (turns < 2) continue;

		const parts = (partsByMessageId.get(msg.id) ?? []).toReversed();
		for (const part of parts) {
			if (part.type !== 'tool_result') continue;
			if (part.toolName && PROTECTED_TOOLS.includes(part.toolName)) continue;
			if (part.compactedAt) continue;

			let content: { result?: unknown };
			try {
				content = JSON.parse(part.content ?? '{}');
			} catch {
				continue;
			}

			const estimate = estimateTokens(
				typeof content.result === 'string'
					? content.result
					: JSON.stringify(content.result ?? ''),
			);
			totalTokens += estimate;

			if (totalTokens > PRUNE_PROTECT) {
				prunedTokens += estimate;
				toPrune.push(part.id);
			}
		}
	}

	const pruned = applyPartCompaction(db, toPrune);
	return { pruned, saved: pruned > 0 ? prunedTokens : 0 };
}
