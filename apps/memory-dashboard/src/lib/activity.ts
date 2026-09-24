import type { MemoryEvent } from '../types.ts';

export const MAX_EVENTS = 500;

export type ConnectionStatus =
	| 'live'
	| 'polling'
	| 'disconnected'
	| 'connecting';

/**
 * Prepends new events (newest first), skipping ids already present and
 * capping the buffer. Returns the same array when nothing changed.
 */
export function mergeEvents(
	current: readonly MemoryEvent[],
	incoming: readonly MemoryEvent[],
	max = MAX_EVENTS,
): { events: MemoryEvent[]; added: MemoryEvent[] } {
	if (incoming.length === 0) return { events: [...current], added: [] };
	const seen = new Set(current.map((event) => String(event.id)));
	const added: MemoryEvent[] = [];
	for (const event of incoming) {
		const id = String(event.id);
		if (seen.has(id)) continue;
		seen.add(id);
		added.push({ ...event, id });
	}
	if (added.length === 0) return { events: [...current], added };
	added.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
	const events = [...added, ...current].slice(0, max);
	return { events, added };
}

/**
 * Highest known event id for `sinceId`. Numeric ids compare numerically;
 * otherwise the newest (head) event wins.
 */
export function latestEventId(
	events: readonly MemoryEvent[],
): string | undefined {
	let best: string | undefined;
	let bestNum = Number.NEGATIVE_INFINITY;
	for (const event of events) {
		const num = Number(event.id);
		if (!Number.isFinite(num)) return events[0]?.id;
		if (num > bestNum) {
			bestNum = num;
			best = event.id;
		}
	}
	return best;
}

export function parseMemoryEvent(raw: string): MemoryEvent | null {
	try {
		const value = JSON.parse(raw) as Partial<MemoryEvent> | null;
		if (!value || typeof value !== 'object') return null;
		if (typeof value.type !== 'string' || value.id === undefined) return null;
		return {
			id: String(value.id),
			at: typeof value.at === 'string' ? value.at : new Date().toISOString(),
			type: value.type,
			agent: typeof value.agent === 'string' ? value.agent : 'unknown',
			sessionId: value.sessionId,
			projectId: value.projectId,
			scope: value.scope,
			memoryIds: Array.isArray(value.memoryIds)
				? value.memoryIds.map(String)
				: [],
			query: typeof value.query === 'string' ? value.query : undefined,
			ranking: value.ranking,
			injectedIds: Array.isArray(value.injectedIds)
				? value.injectedIds.map(String)
				: undefined,
			details: value.details,
		};
	} catch {
		return null;
	}
}
