import type { Message, MessagePart } from '../../types/api';

const COMPACTION_HEADER_PATTERN = /context\s+compacted/i;

export function getMessagePartText(part: MessagePart): string {
	if (part.contentJson && typeof part.contentJson === 'object' && 'text' in part.contentJson) {
		return String(part.contentJson.text);
	}
	const raw = part.content;
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (parsed && typeof parsed === 'object' && 'text' in parsed) {
				return String((parsed as { text: unknown }).text);
			}
		} catch {
			// plain text content
		}
		return raw;
	}
	return '';
}

export function isCompactSlashCommand(content: string): boolean {
	return content.trim().toLowerCase() === '/compact';
}

export function getUserMessageText(message: Message | undefined): string {
	if (!message || message.role !== 'user') return '';
	const textPart = message.parts?.find((part) => part.type === 'text');
	if (!textPart) return '';
	return getMessagePartText(textPart);
}

export function isCompactionSummaryText(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	return (
		COMPACTION_HEADER_PATTERN.test(trimmed) ||
		(trimmed.startsWith('📦') && COMPACTION_HEADER_PATTERN.test(trimmed))
	);
}

export function summarizeCompactionText(text: string): string {
	const normalized = text.replace(/\s+/g, ' ').trim();
	if (!normalized) return 'Context compacted';
	const withoutHeader = normalized
		.replace(/^📦\s*/u, '')
		.replace(/\*\*context compacted\*\*/iu, '')
		.replace(/context compacted:?/iu, '')
		.trim();
	if (!withoutHeader) return 'Context compacted';
	return withoutHeader.length > 96
		? `${withoutHeader.slice(0, 95)}…`
		: withoutHeader;
}

/**
 * Returns true when a text part should use the compact compaction summary box.
 */
export function shouldRenderCompactionSummaryBox(args: {
	compact?: boolean;
	part: MessagePart;
	previousUserMessage?: Message;
}): boolean {
	if (!args.compact || args.part.type !== 'text') return false;

	const text = getMessagePartText(args.part);
	if (!text.trim()) return false;

	const triggeredByCompactCommand = isCompactSlashCommand(
		getUserMessageText(args.previousUserMessage),
	);

	return triggeredByCompactCommand || isCompactionSummaryText(text);
}