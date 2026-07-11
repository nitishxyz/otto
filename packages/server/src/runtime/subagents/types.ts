import type { DB } from '@ottocode/database';
import type { subagents } from '@ottocode/database/schema';
import type { OttoConfig } from '@ottocode/sdk';

export const MAX_CONCURRENT_PER_PARENT = 3;

export type SubagentRecord = typeof subagents.$inferSelect;

export type SpawnSubagentInput = {
	db: DB;
	cfg: OttoConfig;
	parentSessionId: string;
	parentAgent: string;
	agent: string;
	task: string;
	context?: string;
	/**
	 * Existing subagent child session to dispatch the new task into instead of
	 * creating a fresh session. Keeps prior context for related tasks (e.g.
	 * frontend task 1 → frontend task 3). Must belong to the same parent and
	 * the same agent, and must not be running.
	 */
	reuseSessionId?: string;
};

export type SpawnSubagentResult =
	| { ok: true; subagentId: string; childSessionId: string; agent: string }
	| { ok: false; error: string };

export type MessageSubagentInput = {
	db: DB;
	cfg: OttoConfig;
	parentSessionId: string;
	subagentId: string;
	message: string;
	delivery?: 'queue' | 'interrupt';
};

export type MessageSubagentResult =
	| {
			ok: true;
			subagentId: string;
			childSessionId: string;
			agent: string;
			messageId: string;
			delivery: 'queue' | 'interrupt';
			preemptedMessageId: string | null;
	  }
	| { ok: false; error: string };

export type StopSubagentInput = {
	db: DB;
	parentSessionId: string;
	subagentId: string;
};

export type StopSubagentResult =
	| {
			ok: true;
			subagentId: string;
			childSessionId: string;
			agent: string;
			wasRunning: boolean;
			clearedQueuedMessages: number;
	  }
	| { ok: false; error: string };

export type RetrySubagentInput = {
	db: DB;
	cfg: OttoConfig;
	parentSessionId: string;
	subagentId: string;
};

export type RetrySubagentResult =
	| {
			ok: true;
			subagentId: string;
			childSessionId: string;
			agent: string;
			messageId: string;
	  }
	| { ok: false; error: string };
