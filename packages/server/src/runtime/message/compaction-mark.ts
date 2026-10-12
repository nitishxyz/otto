import type { getDb } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import { inArray } from 'drizzle-orm';
import { estimateTokens, PRUNE_PROTECT } from './compaction-limits.ts';
import {
	loadSessionMessages,
	loadSessionPartsByMessageId,
} from './session-order.ts';

const PROTECTED_TOOLS = ['skill'];

type Db = Awaited<ReturnType<typeof getDb>>;

type PartInfo = {
	id: string;
	tokens: number;
	toolCallId: string | null;
	type: 'tool_call' | 'tool_result';
	index: number;
};

type CompactUnit = {
	partIds: string[];
	tokens: number;
};

export type CompactionPlan = { partIds: string[]; saved: number };

/**
 * Selects old tool call/result units (strictly before the boundary message)
 * to hide from model history. Read-only; apply via installCompactionCheckpoint
 * or markSessionCompacted.
 */
export async function planSessionCompaction(
	db: Db,
	sessionId: string,
	boundaryMessageId: string,
): Promise<CompactionPlan> {
	const sessionMessages = await loadSessionMessages(db, sessionId);
	const cutoffIndex = sessionMessages.findIndex(
		(message) => message.id === boundaryMessageId,
	);
	if (cutoffIndex < 0) return { partIds: [], saved: 0 };
	const oldMessages = sessionMessages.slice(0, cutoffIndex);
	const partsByMessageId = await loadSessionPartsByMessageId(db, sessionId);

	const allCompactUnits: CompactUnit[] = [];
	let totalToolTokens = 0;

	for (const msg of oldMessages) {
		const parts = partsByMessageId.get(msg.id) ?? [];
		const eligibleParts: PartInfo[] = [];

		for (const part of parts) {
			if (part.type !== 'tool_call' && part.type !== 'tool_result') continue;
			if (part.toolName && PROTECTED_TOOLS.includes(part.toolName)) continue;
			if (part.compactedAt) continue;

			let content: { result?: unknown; args?: unknown };
			try {
				content = JSON.parse(part.content ?? '{}');
			} catch {
				continue;
			}

			const contentStr =
				part.type === 'tool_result'
					? typeof content.result === 'string'
						? content.result
						: JSON.stringify(content.result ?? '')
					: JSON.stringify(content.args ?? '');

			const tokens = estimateTokens(contentStr);
			totalToolTokens += tokens;
			eligibleParts.push({
				id: part.id,
				tokens,
				toolCallId: part.toolCallId,
				type: part.type,
				index: part.index,
			});
		}

		const pairedCallIds = new Set<string>();
		const callsById = new Map<string, PartInfo[]>();
		const resultsById = new Map<string, PartInfo[]>();

		for (const part of eligibleParts) {
			if (!part.toolCallId) continue;
			const bucket = part.type === 'tool_call' ? callsById : resultsById;
			const items = bucket.get(part.toolCallId) ?? [];
			items.push(part);
			bucket.set(part.toolCallId, items);
		}

		for (const [toolCallId, callParts] of callsById) {
			const resultParts = resultsById.get(toolCallId);
			if (!resultParts?.length) continue;

			const pairParts = [...callParts, ...resultParts].sort(
				(a, b) => a.index - b.index,
			);
			pairedCallIds.add(toolCallId);
			allCompactUnits.push({
				partIds: pairParts.map((part) => part.id),
				tokens: pairParts.reduce((sum, part) => sum + part.tokens, 0),
			});
		}

		for (const part of eligibleParts) {
			if (part.toolCallId && pairedCallIds.has(part.toolCallId)) continue;
			allCompactUnits.push({
				partIds: [part.id],
				tokens: part.tokens,
			});
		}
	}

	const tokensToFree = Math.max(0, totalToolTokens - PRUNE_PROTECT);
	const partIds: string[] = [];
	let freedTokens = 0;
	for (const unit of allCompactUnits) {
		if (freedTokens >= tokensToFree) break;
		freedTokens += unit.tokens;
		partIds.push(...unit.partIds);
	}
	return { partIds, saved: freedTokens };
}

/**
 * Marks part ids compacted in one transaction and returns how many rows were
 * confirmed updated. Throws on persistence failure.
 */
export function applyPartCompaction(db: Db, partIds: string[]): number {
	if (partIds.length === 0) return 0;
	const compactedAt = Date.now();
	return db.transaction((tx) => {
		let updated = 0;
		for (let start = 0; start < partIds.length; start += 500) {
			updated += tx
				.update(messageParts)
				.set({ compactedAt })
				.where(inArray(messageParts.id, partIds.slice(start, start + 500)))
				.returning({ id: messageParts.id })
				.all().length;
		}
		return updated;
	});
}

export async function markSessionCompacted(
	db: Db,
	sessionId: string,
	compactMessageId: string,
	throughMessageId?: string,
): Promise<{ compacted: number; saved: number }> {
	const plan = await planSessionCompaction(
		db,
		sessionId,
		throughMessageId ?? compactMessageId,
	);
	const compacted = applyPartCompaction(db, plan.partIds);
	return { compacted, saved: plan.saved };
}
