import type { Message, MessagePart, MessagesPage } from '../types/api';

/**
 * The message page route pages by whole user→assistant turns: a page carries
 * every part of every message it contains, and consecutive pages never share a
 * message. So the common path here is a plain concatenation that preserves
 * object identity — no message needs merging at all.
 *
 * The merge logic is kept as a defensive fallback for the one case that can
 * still produce two copies of one id: refetching the newest page with a larger
 * part budget can pull in a turn that an older page already holds. Duplicate
 * ids are collapsed (newest copy wins metadata, parts are unioned and ordered)
 * so a turn can never render twice.
 *
 * Pages are stored newest-first: index 0 is the latest page, the last index is
 * the oldest page loaded so far.
 */

function comparePartsByIndex(left: MessagePart, right: MessagePart) {
	const indexDiff = (left.index ?? 0) - (right.index ?? 0);
	if (indexDiff !== 0) return indexDiff;
	if (left.id === right.id) return 0;
	return left.id < right.id ? -1 : 1;
}

function isPartListOrdered(parts: MessagePart[] | undefined) {
	if (!parts || parts.length < 2) return true;
	for (let index = 1; index < parts.length; index++) {
		if (comparePartsByIndex(parts[index - 1], parts[index]) > 0) return false;
	}
	return true;
}

export function sameMessageList(
	left: readonly Message[],
	right: readonly Message[],
) {
	if (left === right) return true;
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

/** Total persisted parts a page currently holds. Mirrors the route's partCount. */
export function countPageParts(items: readonly Message[]): number {
	let total = 0;
	for (const message of items) total += message.parts?.length ?? 0;
	return total;
}

interface MergeCacheEntry {
	sources: Message[];
	merged: Message;
}

/**
 * Keyed on the newest page copy so an unchanged thread re-merges to the exact
 * same `Message` objects. Row memoization and the assistant-turn cache depend
 * on that identity stability.
 */
const mergedMessageCache = new WeakMap<Message, MergeCacheEntry>();

function sameSources(left: readonly Message[], right: readonly Message[]) {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

/**
 * Collapses every page copy of one parent message. `sources` are ordered oldest
 * page first, so the newest copy supplies metadata/status and the newest
 * version of any part that appears more than once.
 */
function mergeMessageCopies(sources: Message[]): Message {
	const newest = sources[sources.length - 1];
	if (sources.length === 1 && isPartListOrdered(newest.parts)) return newest;

	const cached = mergedMessageCache.get(newest);
	if (cached && sameSources(cached.sources, sources)) return cached.merged;

	const partsById = new Map<string, MessagePart>();
	for (const source of sources) {
		for (const part of source.parts ?? []) partsById.set(part.id, part);
	}
	const parts = [...partsById.values()].sort(comparePartsByIndex);
	const merged: Message = { ...newest, parts };
	mergedMessageCache.set(newest, { sources: [...sources], merged });
	return merged;
}

/**
 * Flattens newest-first pages into one chronological thread with a single
 * entry per message. Pages hold whole turns, so this is a concatenation in
 * page order; ids seen more than once (only possible after a widened refetch
 * of the newest page) are collapsed into one message that keeps the position
 * of its oldest copy and the newest copy's metadata.
 */
export function mergeMessagePages(
	pages: readonly MessagesPage[] | undefined,
): Message[] {
	if (!pages?.length) return [];
	const order: string[] = [];
	const sourcesById = new Map<string, Message[]>();
	// Oldest page first so later (newer) copies win metadata and part content.
	for (let pageIndex = pages.length - 1; pageIndex >= 0; pageIndex--) {
		for (const message of pages[pageIndex]?.items ?? []) {
			const existing = sourcesById.get(message.id);
			if (existing) {
				existing.push(message);
				continue;
			}
			sourcesById.set(message.id, [message]);
			order.push(message.id);
		}
	}
	const merged: Message[] = [];
	for (const id of order) {
		const sources = sourcesById.get(id);
		// The single-source path returns the page's own object, so prepending an
		// older page keeps every already-loaded message identical.
		if (sources) merged.push(mergeMessageCopies(sources));
	}
	return merged;
}

/**
 * Reconciles a refetched newest page against the copy already in the cache.
 * The refetch window is capped, so a page that grew past the cap could
 * otherwise drop parts (or whole messages) that are still loaded and still
 * persisted. Fresh parts win; anything the server no longer returns but the
 * cache still holds is kept, oldest first, so nothing already rendered
 * disappears. Optimistic entries are excluded here and re-appended separately.
 */
export function reconcileRefetchedPage(
	cached: MessagesPage | undefined,
	fresh: MessagesPage,
): MessagesPage {
	if (!cached?.items.length) return fresh;
	const freshById = new Map(
		fresh.items.map((message) => [message.id, message]),
	);
	const retained = cached.items.filter(
		(message) =>
			!freshById.has(message.id) &&
			!message.optimistic &&
			(message.parts?.length ?? 0) > 0,
	);
	const cachedById = new Map(
		cached.items.map((message) => [message.id, message]),
	);
	let changed = retained.length > 0;
	const reconciled = fresh.items.map((message) => {
		const previous = cachedById.get(message.id);
		if (!previous?.parts?.length) return message;
		const partsById = new Map<string, MessagePart>();
		for (const part of previous.parts) partsById.set(part.id, part);
		for (const part of message.parts ?? []) partsById.set(part.id, part);
		if (partsById.size === (message.parts?.length ?? 0)) return message;
		changed = true;
		return {
			...message,
			parts: [...partsById.values()].sort(comparePartsByIndex),
		};
	});
	if (!changed) return fresh;
	const items = [...retained, ...reconciled];
	return { ...fresh, items, partCount: countPageParts(items) };
}

/**
 * Writes a merged, flat thread back into the page shape. A message lives on
 * exactly one page — the page it was loaded from — and carries all of its
 * parts, so this is a bucketed pass with no part-level splitting. Messages the
 * cache has not seen before (optimistic sends, a turn that started streaming
 * after the last fetch) join the newest page.
 *
 * Untouched pages are returned by identity, so an update at the live edge never
 * invalidates the older pages above it.
 *
 * Returns `null` when nothing changed.
 */
export function distributeMessagesToPages(
	pages: readonly MessagesPage[],
	next: readonly Message[],
): MessagesPage[] | null {
	if (!pages.length) return null;

	const homePageByMessageId = new Map<string, number>();
	pages.forEach((page, pageIndex) => {
		for (const message of page.items) {
			// Pages are newest-first, so the first hit is the newest copy. Ids
			// only repeat after a widened refetch; the newest page then owns them.
			if (!homePageByMessageId.has(message.id)) {
				homePageByMessageId.set(message.id, pageIndex);
			}
		}
	});

	const nextItems: Message[][] = pages.map(() => []);
	for (const message of next) {
		const target = nextItems[homePageByMessageId.get(message.id) ?? 0];
		// Merged messages are the page's own objects while nothing changed, so
		// pushing them straight back keeps page identity stable.
		if (target) target.push(message);
	}

	let changed = false;
	const result = pages.map((page, pageIndex) => {
		const items = nextItems[pageIndex] ?? [];
		if (sameMessageList(page.items, items)) return page;
		changed = true;
		return { ...page, items, partCount: countPageParts(items) };
	});
	return changed ? result : null;
}
