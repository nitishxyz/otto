import type { MessagePartRow } from './types.ts';

function getReadResultKey(part: MessagePartRow): string | undefined {
	if (part.type !== 'tool_result' || part.compactedAt) return undefined;
	try {
		const content = JSON.parse(part.content ?? '{}') as {
			name?: string;
			result?: unknown;
		};
		if (content.name !== 'read') return undefined;
		if (
			!content.result ||
			typeof content.result !== 'object' ||
			Array.isArray(content.result)
		) {
			return undefined;
		}
		const result = content.result as Record<string, unknown>;
		if (result.ok === false || typeof result.path !== 'string') {
			return undefined;
		}
		const lineRange =
			typeof result.lineRange === 'string' ? result.lineRange : 'full';
		return `${result.path}\u0000${lineRange}`;
	} catch {
		return undefined;
	}
}

export function findSupersededReadPartIds(
	parts: MessagePartRow[],
): Set<string> {
	const latestPartIdByReadKey = new Map<string, string>();
	const readKeyByPartId = new Map<string, string>();
	for (const part of parts) {
		const key = getReadResultKey(part);
		if (!key) continue;
		readKeyByPartId.set(part.id, key);
		latestPartIdByReadKey.set(key, part.id);
	}

	const superseded = new Set<string>();
	for (const [partId, key] of readKeyByPartId) {
		if (latestPartIdByReadKey.get(key) !== partId) superseded.add(partId);
	}
	return superseded;
}

export function getReadCompactedReason(args: {
	name: string;
	partId?: string;
	supersededReadPartIds: Set<string>;
}): string | undefined {
	return args.name === 'read' &&
		args.partId &&
		args.supersededReadPartIds.has(args.partId)
		? 'Superseded by a later read of the same file and line range.'
		: undefined;
}
