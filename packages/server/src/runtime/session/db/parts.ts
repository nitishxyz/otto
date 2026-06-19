import { messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import type { RunOpts } from '../queue.ts';
import type { RuntimeDb } from './types.ts';

/**
 * Removes empty text parts from an assistant message.
 */
export async function cleanupEmptyTextParts(
	opts: RunOpts,
	db: RuntimeDb,
): Promise<void> {
	if (!db) return;

	const parts = await db
		.select()
		.from(messageParts)
		.where(eq(messageParts.messageId, opts.assistantMessageId));

	for (const part of parts) {
		if (part.type === 'text') {
			let text = '';
			try {
				text = JSON.parse(part.content || '{}')?.text || '';
			} catch {}
			if (!text || !text.trim()) {
				await db.delete(messageParts).where(eq(messageParts.id, part.id));
			}
		}
	}
}
