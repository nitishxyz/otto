import type { ClientEvent, NotificationEvent, OttoEvent } from './types.ts';
import { scopedSessionKey } from '../runtime/projects/scope.ts';

type Subscriber = (evt: OttoEvent) => void;
type ClientSubscriber = (evt: ClientEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>(); // project/session -> subs
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
