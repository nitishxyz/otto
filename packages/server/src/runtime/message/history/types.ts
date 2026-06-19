import type { messageParts, messages } from '@ottocode/database/schema';

export type MessageRow = typeof messages.$inferSelect;
export type MessagePartRow = typeof messageParts.$inferSelect;

export type ToolResultRecord = {
	name: string;
	callId: string;
	partId?: string;
	result: unknown;
};
