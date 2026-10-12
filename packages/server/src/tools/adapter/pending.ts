/**
 * Per-call execution record, keyed by the SDK `toolCallId`. Input hooks and
 * `execute` look records up by id; nothing is matched by queue position.
 */
import type { ToolOutcome } from '@ottocode/sdk/tools/error';
import type { ToolResultContent } from './events.ts';

export type ToolCallRecord = {
	callId: string;
	name: string;
	startTs: number;
	stepIndex?: number;
	/** Raw model input (unredacted; never persisted or published as-is). */
	args?: unknown;
	hasPublishedDelta?: boolean;
	/** Set once the call has been persisted/published; finalize is idempotent. */
	finalized?: boolean;
	execution?: Promise<unknown>;
	/** Result part id, fixed before execution so recovery is idempotent. */
	resultPartId?: string;
	/** Durable journal record currently on disk; cleared after commit. */
	journalState?: 'intent' | 'outcome';
	outcome?: ToolOutcome;
	finalization?: {
		partId: string;
		index?: number;
		content: ToolResultContent;
		endTs: number;
		durationMs: number | null;
	};
	inputAvailable?: boolean;
};

export type ToolCallRecords = Map<string, ToolCallRecord>;

export function createToolCallRecords(): ToolCallRecords {
	return new Map();
}

/**
 * Returns the record for `callId`, creating it when missing. Calls without
 * an SDK id get a fresh, unshared record.
 */
export function ensureToolCallRecord(
	records: ToolCallRecords,
	args: { callId?: string; name: string; stepIndex?: number },
): ToolCallRecord {
	if (args.callId) {
		const existing = records.get(args.callId);
		if (existing) {
			if (existing.name !== args.name)
				throw new Error(`Tool call id reused by another tool: ${args.callId}`);
			return existing;
		}
	}
	const record: ToolCallRecord = {
		callId: args.callId || crypto.randomUUID(),
		name: args.name,
		startTs: Date.now(),
		stepIndex: args.stepIndex,
	};
	records.set(record.callId, record);
	return record;
}

export function extractToolCallId(options: unknown): string | undefined {
	const id = (options as { toolCallId?: unknown } | undefined)?.toolCallId;
	return typeof id === 'string' && id ? id : undefined;
}
