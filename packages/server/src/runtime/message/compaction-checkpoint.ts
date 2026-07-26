import type { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';

const MAX_CHECKPOINT_CHARS = 6_000;

function normalizeCheckpoint(summary: string): string {
	const trimmed = summary.trim();
	if (trimmed.length <= MAX_CHECKPOINT_CHARS) return trimmed;
	const marker =
		'\n\n[Checkpoint middle truncated at the hard size limit.]\n\n';
	const contentBudget = MAX_CHECKPOINT_CHARS - marker.length;
	const headChars = Math.floor(contentBudget * 0.67);
	const tailChars = contentBudget - headChars;
	return `${trimmed.slice(0, headChars)}${marker}${trimmed.slice(-tailChars)}`;
}

/** Replaces the canonical checkpoint and moves the model-history cutoff. */
export async function saveCompactionCheckpoint(args: {
	db: Awaited<ReturnType<typeof getDb>>;
	sessionId: string;
	compactionMessageId: string;
	summary: string;
}): Promise<void> {
	const contextSummary = normalizeCheckpoint(args.summary);
	if (!contextSummary) return;

	await args.db
		.update(sessions)
		.set({
			contextSummary,
			compactionMessageId: args.compactionMessageId,
			lastCompactedAt: Date.now(),
			currentContextTokens: null,
		})
		.where(eq(sessions.id, args.sessionId));
}
