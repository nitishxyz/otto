import type { ModelMessage } from 'ai';

const MODEL_HISTORY_MAX_BYTES = 1_500_000;
const COMPACTED_OLD_TEXT_BYTES = 1_000;

function jsonByteLength(value: unknown): number {
	try {
		return Buffer.byteLength(JSON.stringify(value), 'utf8');
	} catch {
		return Buffer.byteLength(String(value), 'utf8');
	}
}

function hasToolishContent(message: ModelMessage): boolean {
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return false;
	return content.some((part) => {
		if (!part || typeof part !== 'object') return false;
		const type = (part as { type?: unknown }).type;
		return typeof type === 'string' && type.startsWith('tool-');
	});
}

function compactOldMessageText(message: ModelMessage): boolean {
	if (hasToolishContent(message)) return false;
	const mutable = message as { content?: unknown };
	if (typeof mutable.content === 'string') {
		if (
			Buffer.byteLength(mutable.content, 'utf8') <= COMPACTED_OLD_TEXT_BYTES
		) {
			return false;
		}
		mutable.content = `${mutable.content.slice(0, COMPACTED_OLD_TEXT_BYTES)}\n… older message text compacted to keep model history under budget …`;
		return true;
	}
	if (!Array.isArray(mutable.content)) return false;

	let changed = false;
	mutable.content = mutable.content.map((part) => {
		if (!part || typeof part !== 'object') return part;
		const record = part as Record<string, unknown>;
		if (record.type !== 'text' || typeof record.text !== 'string') return part;
		if (Buffer.byteLength(record.text, 'utf8') <= COMPACTED_OLD_TEXT_BYTES) {
			return part;
		}
		changed = true;
		return {
			...record,
			text: `${record.text.slice(0, COMPACTED_OLD_TEXT_BYTES)}\n… older message text compacted to keep model history under budget …`,
		};
	});
	return changed;
}

export function enforceModelHistoryBudget(
	history: ModelMessage[],
): ModelMessage[] {
	let totalBytes = jsonByteLength(history);
	if (totalBytes <= MODEL_HISTORY_MAX_BYTES) return history;

	for (let index = 0; index < history.length - 4; index++) {
		if (!compactOldMessageText(history[index])) continue;
		totalBytes = jsonByteLength(history);
		if (totalBytes <= MODEL_HISTORY_MAX_BYTES) break;
	}
	return history;
}
