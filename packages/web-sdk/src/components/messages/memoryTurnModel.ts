import type { MessagePart } from '../../types/api';

/**
 * Per-turn memory visibility.
 *
 * Two data sources feed one summary:
 *
 * 1. A synthetic `tool_result` part the runtime persists on the assistant
 *    message for automatic recall/capture (mirrors `message_context`):
 *    ```
 *    { name: 'memory_context', synthetic: true, origin: 'memory_context',
 *      result: {
 *        recall?:  { query, ranking: 'typesafe' | 'fts',
 *                    retrieved: Memory[], injectedIds: string[] },
 *        capture?: { candidates: string[],
 *                    results: Array<{ candidate, status, reason?, memory? }> } } }
 *    ```
 * 2. Explicit `remember` / `forget_memory` tool results the model produced in
 *    the same turn (regular, non-synthetic parts).
 */

export const MEMORY_CONTEXT_ORIGIN = 'memory_context';
export const MEMORY_TOOL_NAMES = new Set([
	'remember',
	'recall_memory',
	'forget_memory',
]);

export type MemoryScope = 'global' | 'project' | 'session';
export type MemoryOrigin = 'explicit' | 'inferred';
export type MemoryRanking = 'typesafe' | 'fts';

export interface MemoryRecord {
	id: string;
	content: string;
	scope: MemoryScope;
	origin?: MemoryOrigin;
	source?: string;
}

export interface MemoryRecallEntry extends MemoryRecord {
	/** True when the runtime actually placed this memory in the prompt. */
	injected: boolean;
}

export type MemoryWriteStatus =
	| 'created'
	| 'updated'
	| 'duplicate'
	| 'rejected'
	| 'unavailable'
	| 'skipped'
	| 'forgotten'
	| 'not_found';

export interface MemoryWriteEntry {
	key: string;
	status: MemoryWriteStatus;
	/** Proposed text (capture candidate or `remember` argument). */
	content: string;
	scope?: MemoryScope;
	source?: string;
	/** `explicit` for a `remember`/`forget_memory` call, `inferred` for auto-capture. */
	origin: MemoryOrigin;
	reason?: string;
	/** Persisted record when the write landed. */
	memory?: MemoryRecord;
}

export interface MemoryTurnSummary {
	recall: {
		query?: string;
		ranking?: MemoryRanking;
		entries: MemoryRecallEntry[];
	} | null;
	writes: MemoryWriteEntry[];
	injectedCount: number;
	retrievedCount: number;
	savedCount: number;
	updatedCount: number;
	skippedCount: number;
	forgottenCount: number;
}

const PERSISTED_STATUSES = new Set<MemoryWriteStatus>(['created', 'updated']);
const SKIPPED_STATUSES = new Set<MemoryWriteStatus>([
	'duplicate',
	'rejected',
	'unavailable',
	'skipped',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value : undefined;
}

function asScope(value: unknown): MemoryScope | undefined {
	return value === 'global' || value === 'project' || value === 'session'
		? value
		: undefined;
}

function asOrigin(value: unknown): MemoryOrigin | undefined {
	return value === 'explicit' || value === 'inferred' ? value : undefined;
}

function parsePartPayload(part: MessagePart): Record<string, unknown> | null {
	if (part.contentJson && typeof part.contentJson === 'object') {
		return part.contentJson;
	}
	try {
		return asRecord(JSON.parse(part.content || '{}'));
	} catch {
		return null;
	}
}

function toMemoryRecord(value: unknown): MemoryRecord | null {
	const row = asRecord(value);
	if (!row) return null;
	const id = asString(row.id);
	const content = asString(row.content);
	const scope = asScope(row.scope) ?? 'project';
	if (!id || !content) return null;
	return {
		id,
		content,
		scope,
		origin: asOrigin(row.origin),
		source: asString(row.source),
	};
}

/** Synthetic memory parts are summarized by {@link MemoryActivity}, never rendered as tool rows. */
export function isMemoryContextPart(part: MessagePart): boolean {
	if (part.type !== 'tool_call' && part.type !== 'tool_result') return false;
	const payload = parsePartPayload(part);
	return (
		payload?.synthetic === true && payload.origin === MEMORY_CONTEXT_ORIGIN
	);
}

export function isMemoryToolName(toolName: string | null | undefined) {
	return MEMORY_TOOL_NAMES.has(toolName || '');
}

function parseRecall(value: unknown): MemoryTurnSummary['recall'] {
	const recall = asRecord(value);
	if (!recall) return null;
	const retrieved = Array.isArray(recall.retrieved) ? recall.retrieved : [];
	const injectedIds = new Set(
		Array.isArray(recall.injectedIds)
			? recall.injectedIds.filter((id): id is string => typeof id === 'string')
			: [],
	);
	const entries = retrieved.flatMap((row) => {
		const record = toMemoryRecord(row);
		return record ? [{ ...record, injected: injectedIds.has(record.id) }] : [];
	});
	const ranking =
		recall.ranking === 'typesafe' || recall.ranking === 'fts'
			? recall.ranking
			: undefined;
	return { query: asString(recall.query), ranking, entries };
}

function parseCaptureWrites(value: unknown, key: string): MemoryWriteEntry[] {
	const capture = asRecord(value);
	if (!capture) return [];
	const candidates = Array.isArray(capture.candidates)
		? capture.candidates.filter(
				(item): item is string => typeof item === 'string',
			)
		: [];
	const results = Array.isArray(capture.results) ? capture.results : [];
	const writes: MemoryWriteEntry[] = [];
	const seen = new Set<string>();
	results.forEach((raw, index) => {
		const row = asRecord(raw);
		if (!row) return;
		const memory = toMemoryRecord(row.memory) ?? undefined;
		const content = asString(row.candidate) ?? memory?.content;
		if (!content) return;
		seen.add(content);
		const status = normalizeWriteStatus(row.status);
		writes.push({
			key: `${key}:capture:${index}`,
			status,
			content,
			scope: memory?.scope ?? asScope(row.scope),
			source: memory?.source ?? asString(row.source),
			origin: 'inferred',
			reason: asString(row.reason),
			memory,
		});
	});
	candidates.forEach((candidate, index) => {
		if (seen.has(candidate)) return;
		writes.push({
			key: `${key}:candidate:${index}`,
			status: 'skipped',
			content: candidate,
			origin: 'inferred',
			reason: 'Not judged durable',
		});
	});
	return writes;
}

function normalizeWriteStatus(value: unknown): MemoryWriteStatus {
	switch (value) {
		case 'created':
		case 'updated':
		case 'duplicate':
		case 'rejected':
		case 'unavailable':
		case 'skipped':
		case 'forgotten':
		case 'not_found':
			return value;
		default:
			return 'skipped';
	}
}

function parseExplicitWrite(part: MessagePart): MemoryWriteEntry | null {
	const payload = parsePartPayload(part);
	if (!payload) return null;
	const args = asRecord(payload.args) ?? {};
	const result = asRecord(payload.result) ?? {};
	if (part.toolName === 'remember') {
		const memory = toMemoryRecord(result.memory) ?? undefined;
		const content = asString(args.content) ?? memory?.content;
		if (!content) return null;
		return {
			key: `part:${part.id}`,
			status: normalizeWriteStatus(result.status),
			content,
			scope: memory?.scope ?? asScope(args.scope) ?? 'project',
			source: memory?.source ?? asString(args.source),
			origin: 'explicit',
			reason: asString(result.reason),
			memory,
		};
	}
	if (part.toolName === 'forget_memory') {
		const id = asString(args.id);
		if (!id) return null;
		return {
			key: `part:${part.id}`,
			status: result.forgotten === true ? 'forgotten' : 'not_found',
			content: id,
			origin: 'explicit',
			reason:
				result.forgotten === true
					? undefined
					: 'No accessible memory with this ID',
		};
	}
	return null;
}

/**
 * Builds the memory summary for one assistant turn, or `null` when the turn
 * neither recalled nor attempted to write any memory.
 */
export function getMemoryTurnSummary(
	parts: MessagePart[],
): MemoryTurnSummary | null {
	let recall: MemoryTurnSummary['recall'] = null;
	const writes: MemoryWriteEntry[] = [];
	for (const part of parts) {
		if (part.type !== 'tool_result') continue;
		if (isMemoryContextPart(part)) {
			const result = asRecord(parsePartPayload(part)?.result);
			if (!result) continue;
			const parsedRecall = parseRecall(result.recall);
			if (parsedRecall && (!recall || parsedRecall.entries.length)) {
				recall = parsedRecall;
			}
			writes.push(...parseCaptureWrites(result.capture, `part:${part.id}`));
			continue;
		}
		if (part.toolName === 'remember' || part.toolName === 'forget_memory') {
			const write = parseExplicitWrite(part);
			if (write) writes.push(write);
		}
	}
	const retrievedCount = recall?.entries.length ?? 0;
	if (!retrievedCount && writes.length === 0) return null;
	const injectedCount =
		recall?.entries.filter((entry) => entry.injected).length ?? 0;
	return {
		recall,
		writes,
		injectedCount,
		retrievedCount,
		savedCount: writes.filter((write) => write.status === 'created').length,
		updatedCount: writes.filter((write) => write.status === 'updated').length,
		skippedCount: writes.filter((write) => SKIPPED_STATUSES.has(write.status))
			.length,
		forgottenCount: writes.filter((write) => write.status === 'forgotten')
			.length,
	};
}

export function isPersistedWrite(status: MemoryWriteStatus) {
	return PERSISTED_STATUSES.has(status);
}

/** Compact one-line label, e.g. `Used 2 memories · Saved 1 · Skipped 1`. */
export function formatMemorySummaryLabel(summary: MemoryTurnSummary): string {
	const segments: string[] = [];
	if (summary.injectedCount > 0) {
		segments.push(
			`Used ${summary.injectedCount} ${
				summary.injectedCount === 1 ? 'memory' : 'memories'
			}`,
		);
	} else if (summary.retrievedCount > 0) {
		segments.push(`Retrieved ${summary.retrievedCount}, none injected`);
	}
	if (summary.savedCount > 0) segments.push(`Saved ${summary.savedCount}`);
	if (summary.updatedCount > 0)
		segments.push(`Updated ${summary.updatedCount}`);
	if (summary.forgottenCount > 0)
		segments.push(`Forgot ${summary.forgottenCount}`);
	if (summary.skippedCount > 0)
		segments.push(`Skipped ${summary.skippedCount}`);
	return segments.join(' · ') || 'Memory';
}
