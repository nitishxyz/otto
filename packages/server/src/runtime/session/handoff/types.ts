import type { sessions } from '@ottocode/database/schema';

export type SessionRow = typeof sessions.$inferSelect;

export type HandoffResult = {
	session: SessionRow;
	sourceSessionId: string;
	context: string;
	message: string;
};
