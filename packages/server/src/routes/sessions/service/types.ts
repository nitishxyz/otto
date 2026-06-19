import type { getDb } from '@ottocode/database';
import type {
	messageParts,
	messages,
	sessions,
} from '@ottocode/database/schema';
import type { loadConfig } from '@ottocode/sdk';

export type SessionRow = typeof sessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type MessagePartRow = typeof messageParts.$inferSelect;

export interface SessionFileStats {
	changedFiles: number;
	additions: number;
	deletions: number;
	operations: number;
}

export type ProjectDbContext = {
	cfg: Awaited<ReturnType<typeof loadConfig>>;
	db: Awaited<ReturnType<typeof getDb>>;
};
