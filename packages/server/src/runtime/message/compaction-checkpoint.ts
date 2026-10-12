import type { getDb } from '@ottocode/database';
import { messageParts, sessions } from '@ottocode/database/schema';
import { eq, inArray } from 'drizzle-orm';

const MAX_CHECKPOINT_CHARS = 6_000;

type Db = Awaited<ReturnType<typeof getDb>>;

export function normalizeCheckpoint(summary: string): string {
	const trimmed = summary.trim();
	if (trimmed.length <= MAX_CHECKPOINT_CHARS) return trimmed;
	const marker =
		'\n\n[Checkpoint middle truncated at the hard size limit.]\n\n';
	const contentBudget = MAX_CHECKPOINT_CHARS - marker.length;
	const headChars = Math.floor(contentBudget * 0.67);
	const tailChars = contentBudget - headChars;
	return `${trimmed.slice(0, headChars)}${marker}${trimmed.slice(-tailChars)}`;
}

export type InstallCompactionCheckpointArgs = {
	db: Db;
	sessionId: string;
	/** Message that displays the checkpoint summary; never part of model history. */
	summaryMessageId: string;
	/** Last message whose evidence the summary covers; history resumes after it. Defaults to summaryMessageId. */
	summarizedThroughMessageId?: string;
	summary: string;
	/** Tool parts hidden from model history by this checkpoint. */
	compactPartIds?: string[];
	/** Final content for the streamed summary part, written with the checkpoint. */
	summaryPart?: { partId: string; content: string };
};

/**
 * Atomically installs a checkpoint: summary part content, compacted tool
 * parts, and the session's summary/boundary identities commit together or
 * not at all. Returns the number of parts confirmed compacted.
 */
export function installCompactionCheckpoint(
	args: InstallCompactionCheckpointArgs,
): { installed: boolean; compacted: number } {
	const contextSummary = normalizeCheckpoint(args.summary);
	if (!contextSummary) return { installed: false, compacted: 0 };
	const now = Date.now();
	return args.db.transaction((tx) => {
		if (args.summaryPart) {
			tx.update(messageParts)
				.set({ content: args.summaryPart.content, completedAt: now })
				.where(eq(messageParts.id, args.summaryPart.partId))
				.run();
		}
		let compacted = 0;
		const partIds = args.compactPartIds ?? [];
		for (let start = 0; start < partIds.length; start += 500) {
			const updated = tx
				.update(messageParts)
				.set({ compactedAt: now })
				.where(inArray(messageParts.id, partIds.slice(start, start + 500)))
				.returning({ id: messageParts.id })
				.all();
			compacted += updated.length;
		}
		tx.update(sessions)
			.set({
				contextSummary,
				compactionMessageId: args.summaryMessageId,
				compactionThroughMessageId:
					args.summarizedThroughMessageId ?? args.summaryMessageId,
				lastCompactedAt: now,
				currentContextTokens: null,
			})
			.where(eq(sessions.id, args.sessionId))
			.run();
		return { installed: true, compacted };
	});
}

/**
 * Replaces the canonical checkpoint and moves the model-history cutoff.
 * `summarizedThroughMessageId` defaults to the summary message itself.
 */
export async function saveCompactionCheckpoint(args: {
	db: Db;
	sessionId: string;
	compactionMessageId: string;
	summary: string;
	summarizedThroughMessageId?: string;
}): Promise<void> {
	installCompactionCheckpoint({
		db: args.db,
		sessionId: args.sessionId,
		summaryMessageId: args.compactionMessageId,
		summarizedThroughMessageId: args.summarizedThroughMessageId,
		summary: args.summary,
	});
}
