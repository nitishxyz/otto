import type { ClientEvent, NotificationEvent, OttoEvent } from './types.ts';
import {
	projectScopeKey,
	scopedSessionKey,
} from '../runtime/projects/scope.ts';
import {
	recordProjectClientEvent,
	recordProjectSessionEvent,
	type ProjectReplayRecord,
} from './project-replay.ts';

type Subscriber = (evt: OttoEvent, replay: ProjectReplayRecord) => void;
type ClientSubscriber = (evt: ClientEvent, replay: ProjectReplayRecord) => void;

const subscribers = new Map<string, Set<Subscriber>>(); // project/session -> subs
const projectSubscribers = new Map<string, Set<Subscriber>>(); // project -> subs
const desktopSubscribers = new Set<Subscriber>();
const clientSubscribers = new Set<ClientSubscriber>();

/**
 * Events may carry projectId, projectRoot, or both, while subscribers key by
 * whichever value they had at hand (routes use the resolved project root).
 * Route on every distinct key so publisher and subscriber never have to agree
 * on which identifier to use.
 */
function eventProjectKeys(event: OttoEvent): string[] {
	const keys = new Set<string>();
	if (event.projectId) keys.add(projectScopeKey(event.projectId));
	if (event.projectRoot) keys.add(projectScopeKey(event.projectRoot));
	if (keys.size === 0) keys.add(projectScopeKey(undefined));
	return [...keys];
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
	const replay = recordProjectSessionEvent(sanitizedEvent);
	const notified = new Set<Subscriber>();
	const dispatch = (subs: Set<Subscriber> | undefined, label: string) => {
		if (!subs) return;
		for (const sub of subs) {
			if (notified.has(sub)) continue;
			notified.add(sub);
			try {
				sub(sanitizedEvent, replay);
			} catch (err) {
				console.error(
					`[bus] ${label} threw on event ${event.type}:`,
					err instanceof Error ? err.message : String(err),
				);
			}
		}
	};
	dispatch(desktopSubscribers, 'Desktop subscriber');
	for (const projectKey of eventProjectKeys(event)) {
		dispatch(projectSubscribers.get(projectKey), 'Project subscriber');
		dispatch(subscribers.get(`${projectKey}:${event.sessionId}`), 'Subscriber');
	}
}

/** Subscribes to every session event across all daemon projects. */
export function subscribeDesktopEvents(handler: Subscriber) {
	desktopSubscribers.add(handler);
	return () => {
		desktopSubscribers.delete(handler);
	};
}

export function publishClientEvent(event: ClientEvent) {
	const sanitizedEvent = sanitizeBigInt(event);
	const replay = recordProjectClientEvent(sanitizedEvent);
	for (const sub of clientSubscribers) {
		try {
			sub(sanitizedEvent, replay);
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
	desktopSubscribers: number;
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
		desktopSubscribers: desktopSubscribers.size,
		topSessionKeys: perKey.slice(0, 10),
	};
}
