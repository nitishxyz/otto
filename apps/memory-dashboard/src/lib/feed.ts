import type { EdgeType, MemoryEvent } from '../types.ts';
import { excerpt, redactSecrets } from './text.ts';
import { agentPhrase, EDGE_NAMES } from './vocab.ts';

export type FeedTone =
	| 'added'
	| 'updated'
	| 'used'
	| 'lookup'
	| 'forgot'
	| 'linked';

export interface FeedItem {
	event: MemoryEvent;
	tone: FeedTone;
	/** Leading phrase, e.g. "Remembered" or "Used 2 memories for". */
	verb: string;
	/** Untrusted text (memory title or query), already redacted and trimmed. */
	subject: string;
	note?: string;
	via: string | null;
	/** Hidden unless the user asks to see all activity. */
	quiet: boolean;
}

export type LabelLookup = (id: string) => string | undefined;

const EDGE_TYPES = new Set<string>([
	'supersedes',
	'refines',
	'contradicts',
	'relates_to',
	'derived_from',
	'about',
]);

function linkType(event: MemoryEvent): EdgeType | undefined {
	const details = event.details;
	if (!details || typeof details !== 'object') return undefined;
	const value = (details as { edgeType?: unknown }).edgeType;
	return typeof value === 'string' && EDGE_TYPES.has(value)
		? (value as EdgeType)
		: undefined;
}

/**
 * Lookups that found nothing, and "replaces" links that duplicate the update
 * event logged alongside them, are noise for most people.
 */
export function isQuietEvent(event: MemoryEvent): boolean {
	if (event.type === 'recall') return event.memoryIds.length === 0;
	if (event.type === 'link') return linkType(event) === 'supersedes';
	return false;
}

function memoryWord(count: number): string {
	return count === 1 ? '1 memory' : `${count} memories`;
}

/** Turns a raw memory event into a plain-language sentence. */
export function describeEvent(
	event: MemoryEvent,
	labelOf: LabelLookup,
): FeedItem {
	const label = (index = 0, max = 90) => {
		const id = event.memoryIds[index];
		const text = id ? labelOf(id) : undefined;
		if (text) return excerpt(redactSecrets(text), max);
		return event.type === 'forget' ? 'a memory' : 'a memory (since removed)';
	};
	const query = event.query ? excerpt(redactSecrets(event.query), 90) : '';
	const base = {
		event,
		via: agentPhrase(event.agent),
		quiet: isQuietEvent(event),
	};
	const count = event.memoryIds.length;
	switch (event.type) {
		case 'remember':
			return { ...base, tone: 'added', verb: 'Remembered', subject: label() };
		case 'capture':
			return { ...base, tone: 'added', verb: 'Noticed', subject: label() };
		case 'update':
			return {
				...base,
				tone: 'updated',
				verb: 'Updated',
				subject: label(),
				note: 'replaced an older version',
			};
		case 'forget':
			return { ...base, tone: 'forgot', verb: 'Forgot', subject: label() };
		case 'link': {
			const type = linkType(event);
			return {
				...base,
				tone: 'linked',
				verb: 'Linked',
				subject: `${label(0, 44)} \u2194 ${label(1, 44)}`,
				note: type ? EDGE_NAMES[type].toLowerCase() : undefined,
			};
		}
		case 'recall': {
			if (count === 0) {
				return {
					...base,
					tone: 'lookup',
					verb: 'Looked up',
					subject: query || 'something',
					note: 'nothing relevant',
				};
			}
			return {
				...base,
				tone: 'used',
				verb: query
					? `Used ${memoryWord(count)} for`
					: `Used ${memoryWord(count)}`,
				subject: query || label(),
			};
		}
		default:
			return { ...base, tone: 'linked', verb: 'Activity', subject: label() };
	}
}

export type FeedGroupKey = 'now' | 'today' | 'earlier';

export interface FeedGroup {
	key: FeedGroupKey;
	title: string;
	items: FeedItem[];
}

const GROUP_TITLES: Record<FeedGroupKey, string> = {
	now: 'Just now',
	today: 'Today',
	earlier: 'Earlier',
};
const JUST_NOW_MS = 5 * 60_000;

function groupKey(iso: string, now: number): FeedGroupKey {
	const t = Date.parse(iso);
	if (!Number.isFinite(t) || now - t < JUST_NOW_MS) return 'now';
	return new Date(t).toDateString() === new Date(now).toDateString()
		? 'today'
		: 'earlier';
}

/** Newest-first events grouped by time; quiet events are counted and hidden. */
export function groupFeed(
	events: readonly MemoryEvent[],
	options: { now: number; showAll: boolean; labelOf: LabelLookup },
): { groups: FeedGroup[]; hiddenCount: number } {
	const groups = new Map<FeedGroupKey, FeedGroup>();
	let hiddenCount = 0;
	for (const event of events) {
		const item = describeEvent(event, options.labelOf);
		if (item.quiet && !options.showAll) {
			hiddenCount += 1;
			continue;
		}
		const key = groupKey(event.at, options.now);
		let group = groups.get(key);
		if (!group) {
			group = { key, title: GROUP_TITLES[key], items: [] };
			groups.set(key, group);
		}
		group.items.push(item);
	}
	const order: FeedGroupKey[] = ['now', 'today', 'earlier'];
	return {
		groups: order.flatMap((key) => {
			const group = groups.get(key);
			return group ? [group] : [];
		}),
		hiddenCount,
	};
}
