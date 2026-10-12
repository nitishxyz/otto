import type { getDb } from '@ottocode/database';
import {
	loadSessionMessages,
	loadSessionPartsByMessageId,
	readCheckpointBoundary,
	splitAtCheckpoint,
} from './session-order.ts';

const PREVIOUS_CHECKPOINT_MAX_CHARS = 6_000;

function boundEvidence(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const marker = '\n[...omitted...]\n';
	if (maxChars <= marker.length) return text.slice(0, maxChars);
	const head = Math.ceil((maxChars - marker.length) / 2);
	return `${text.slice(0, head)}${marker}${text.slice(-(maxChars - marker.length - head))}`;
}

/** Builds bounded evidence in chronological order, reserving space for user intent. */
export async function buildCompactionContext(
	db: Awaited<ReturnType<typeof getDb>>,
	sessionId: string,
	contextTokenLimit?: number,
	throughMessageId?: string,
): Promise<string> {
	const boundary = await readCheckpointBoundary(db, sessionId);
	const previousCheckpoint = boundary.contextSummary?.trim() ?? '';
	const sessionMessages = await loadSessionMessages(db, sessionId);
	const cutoffIndex = throughMessageId
		? sessionMessages.findIndex((msg) => msg.id === throughMessageId)
		: -1;
	if (throughMessageId && cutoffIndex < 0) {
		throw new Error('Compaction boundary message not found');
	}
	const throughCutoff =
		cutoffIndex >= 0
			? sessionMessages.slice(0, cutoffIndex + 1)
			: sessionMessages;
	// Evidence after the previous checkpoint's boundary, without its summary message.
	const { after: allMessages, boundaryRow } = splitAtCheckpoint(
		throughCutoff,
		boundary,
	);
	const partsByMessageId = await loadSessionPartsByMessageId(
		db,
		sessionId,
		boundaryRow?.sequence,
	);

	const maxChars = Math.max(0, Math.floor((contextTokenLimit ?? 15_000) * 4));
	const result: string[] = [];
	let remaining = maxChars;
	const append = (text: string) => {
		const separator = result.length ? 1 : 0;
		const budget = remaining - separator;
		if (budget <= 0) return;
		const bounded = boundEvidence(text, budget);
		result.push(bounded);
		remaining -= bounded.length + separator;
	};
	if (previousCheckpoint) {
		append('[--- PREVIOUS CHECKPOINT (merge and replace) ---]');
		append(boundEvidence(previousCheckpoint, PREVIOUS_CHECKPOINT_MAX_CHARS));
	}
	append(
		'[--- POST-CHECKPOINT CONVERSATION (bounded; omissions are not completion) ---]',
	);

	const evidence: {
		order: number;
		text: string;
		user: boolean;
		narrative: boolean;
	}[] = [];
	for (const msg of allMessages) {
		const parts = partsByMessageId.get(msg.id) ?? [];
		for (const part of parts) {
			if (part.compactedAt) continue;
			try {
				const content = JSON.parse(part.content ?? '{}');
				let text = '';
				if (part.type === 'text' && typeof content.text === 'string') {
					if (content.text.trim() === '/compact') continue;
					text = `[${msg.role.toUpperCase()}]: ${content.text}`;
				} else if (part.type === 'tool_call' && content.name) {
					text = `[TOOL ${content.name}]: ${JSON.stringify(content.args ?? {})}`;
				} else if (part.type === 'tool_result' && content.result != null) {
					const value =
						typeof content.result === 'string'
							? content.result
							: JSON.stringify(content.result);
					text = `[RESULT]: ${value}`;
				}
				if (text)
					evidence.push({
						order: evidence.length,
						text,
						user: msg.role === 'user',
						narrative: part.type === 'text',
					});
			} catch {}
		}
	}

	// Keep instructions from across the session even when tool output dominates.
	const instructions = evidence.filter((line) => line.user);
	const selected = new Map<number, string>();
	const narrativeBudget = Math.floor(remaining * 0.15);
	const instructionBudget = Math.floor(remaining * 0.4);
	const perInstruction = Math.min(
		8_000,
		Math.floor(instructionBudget / Math.max(1, instructions.length)),
	);
	for (const line of instructions) {
		if (perInstruction < 2) break;
		const text = boundEvidence(line.text, perInstruction - 1);
		selected.set(line.order, text);
		remaining -= text.length + 1;
	}

	// Retain intermediate decisions and progress, not just requests and final logs.
	const narratives = evidence.filter((line) => line.narrative && !line.user);
	const perNarrative = Math.min(
		2_000,
		Math.floor(narrativeBudget / Math.max(1, narratives.length)),
	);
	for (const line of narratives) {
		if (perNarrative < 2) break;
		const text = boundEvidence(line.text, perNarrative - 1);
		selected.set(line.order, text);
		remaining -= text.length + 1;
	}

	// Work backwards so the last operation and its result survive long tool loops.
	for (const line of evidence.toReversed()) {
		if (selected.has(line.order)) continue;
		if (remaining < 100) break;
		const text = boundEvidence(line.text, Math.min(4_000, remaining - 1));
		selected.set(line.order, text);
		remaining -= text.length + 1;
	}
	for (const [, text] of [...selected].sort(([a], [b]) => a - b)) {
		result.push(text);
	}
	return result.join('\n');
}
