import type { ClientEvent, NotificationEvent, OttoEvent } from './types.ts';
import {
	projectScopeKey,
	scopedSessionKey,
} from '../runtime/projects/scope.ts';

type Subscriber = (evt: OttoEvent) => void;
type ClientSubscriber = (evt: ClientEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>(); // project/session -> subs
const projectSubscribers = new Map<string, Set<Subscriber>>(); // project -> subs
const clientSubscribers = new Set<ClientSubscriber>();

function eventProjectKey(event: OttoEvent): string | undefined {
	return event.projectId ?? event.projectRoot;
}

function sanitizeBigInt<T>(obj: T): T {
	if (obj === null || obj === undefined) return obj;
	if (typeof obj === 'bigint') return Number(obj) as T;
	if (Array.isArray(obj)) return obj.map(sanitizeBigInt) as T;
	if (typeof obj === 'object') {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = sanitizeBigInt(value);
		}
		return result as T;
	}
	return obj;
}

export function publish(event: OttoEvent) {
	const sanitizedEvent = sanitizeBigInt(event);
	const projectSubs = projectSubscribers.get(
		projectScopeKey(eventProjectKey(event)),
	);
	if (projectSubs) {
		for (const sub of projectSubs) {
			try {
				sub(sanitizedEvent);
			} catch (err) {
				console.error(
					`[bus] Project subscriber threw on event ${event.type}:`,
					err instanceof Error ? err.message : String(err),
				);
			}
		}
	}
	const subs = subscribers.get(
		scopedSessionKey(eventProjectKey(event), event.sessionId),
	);
	if (!subs) return;
	for (const sub of subs) {
		try {
			sub(sanitizedEvent);
		} catch (err) {
			console.error(
				`[bus] Subscriber threw on event ${event.type}:`,
				err instanceof Error ? err.message : String(err),
			);
		}
	}
}

export function publishClientEvent(event: ClientEvent) {
	const sanitizedEvent = sanitizeBigInt(event);
	for (const sub of clientSubscribers) {
		try {
			sub(sanitizedEvent);
		} catch (err) {
			console.error(
				`[bus] Client subscriber threw on event ${event.type}:`,
				err instanceof Error ? err.message : String(err),
			);
		}
	}
}

export function publishNotification(payload: NotificationEvent) {
	publishClientEvent({ type: 'notification', payload });
}

export function subscribe(
	sessionId: string,
	handler: Subscriber,
	projectKey?: string,
) {
	const key = scopedSessionKey(projectKey, sessionId);
	let set = subscribers.get(key);
	if (!set) {
		set = new Set();
		subscribers.set(key, set);
	}
	set.add(handler);
	return () => {
		set?.delete(handler);
		if (set && set.size === 0) subscribers.delete(key);
	};
}

export function subscribeClientEvents(handler: ClientSubscriber) {
	clientSubscribers.add(handler);
	return () => {
		clientSubscribers.delete(handler);
	};
}

/**
 * Subscribe to every session event published for a project scope. Used by the
 * multiplexed project event stream so one SSE connection can carry all
 * sessions of a project.
 */
export function subscribeProjectEvents(
	projectKey: string | undefined,
	handler: Subscriber,
) {
	const key = projectScopeKey(projectKey);
	let set = projectSubscribers.get(key);
	if (!set) {
		set = new Set();
		projectSubscribers.set(key, set);
	}
	set.add(handler);
	return () => {
		set?.delete(handler);
		if (set && set.size === 0) projectSubscribers.delete(key);
	};
}

export interface BusStats {
	sessionKeys: number;
	sessionSubscribers: number;
	projectSubscribers: number;
	clientSubscribers: number;
	topSessionKeys: Array<{ key: string; subscribers: number }>;
}

export function getBusStats(): BusStats {
	let total = 0;
	const perKey: Array<{ key: string; subscribers: number }> = [];
	for (const [key, set] of subscribers) {
		total += set.size;
		perKey.push({ key, subscribers: set.size });
	}
	perKey.sort((a, b) => b.subscribers - a.subscribers);
	let projectSubs = 0;
	for (const set of projectSubscribers.values()) projectSubs += set.size;
	return {
		sessionKeys: subscribers.size,
		sessionSubscribers: total,
		projectSubscribers: projectSubs,
		clientSubscribers: clientSubscribers.size,
		topSessionKeys: perKey.slice(0, 10),
	};
}
