import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { eq, asc, and, lt } from 'drizzle-orm';
import { estimateTokens, PRUNE_PROTECT } from './compaction-limits.ts';

const PROTECTED_TOOLS = ['skill'];

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

export async function markSessionCompacted(
	db: Awaited<ReturnType<typeof getDb>>,
	sessionId: string,
	compactMessageId: string,
	throughMessageId?: string,
): Promise<{ compacted: number; saved: number }> {
	const cutoffMsg = await db
		.select()
		.from(messages)
		.where(eq(messages.id, throughMessageId ?? compactMessageId))
		.limit(1);

	if (!cutoffMsg.length) {
		return { compacted: 0, saved: 0 };
	}

	const cutoffTime = cutoffMsg[0].createdAt;

	const oldMessages = await db
		.select()
		.from(messages)
		.where(
			and(
				eq(messages.sessionId, sessionId),
				lt(messages.createdAt, cutoffTime),
			),
		)
		.orderBy(asc(messages.createdAt));

	const allCompactUnits: CompactUnit[] = [];
	let totalToolTokens = 0;

	for (const msg of oldMessages) {
		const parts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, msg.id))
			.orderBy(asc(messageParts.index));

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

	const toCompact: CompactUnit[] = [];
	let freedTokens = 0;

	for (const unit of allCompactUnits) {
		if (freedTokens >= tokensToFree) break;
		freedTokens += unit.tokens;
		toCompact.push(unit);
	}

	if (toCompact.length > 0) {
		const compactedAt = Date.now();

		for (const unit of toCompact) {
			for (const partId of unit.partIds) {
				try {
					await db
						.update(messageParts)
						.set({ compactedAt })
						.where(eq(messageParts.id, partId));
				} catch {}
			}
		}

		const compactedParts = toCompact.reduce(
			(sum, unit) => sum + unit.partIds.length,
			0,
		);
		return { compacted: compactedParts, saved: freedTokens };
	}

	return { compacted: 0, saved: freedTokens };
}
