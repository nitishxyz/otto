import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import {
	latestEventId,
	mergeEvents,
	parseMemoryEvent,
	type ConnectionStatus,
} from '../lib/activity.ts';
import type { MemoryEvent } from '../types.ts';

const POLL_INTERVAL_MS = 3000;
const SSE_RETRY_MS = 15000;
const INITIAL_LIMIT = 100;

export interface ActivityStream {
	events: MemoryEvent[];
	status: ConnectionStatus;
	lastEventAt: string | null;
}

/**
 * Subscribes to `/api/events` (SSE) and falls back to polling
 * `/api/activity?sinceId=` when the stream drops. Every new event is handed
 * to `onEvent` exactly once, in arrival order.
 */
export function useActivityStream(
	onEvent: (event: MemoryEvent) => void,
): ActivityStream {
	const [events, setEvents] = useState<MemoryEvent[]>([]);
	const [status, setStatus] = useState<ConnectionStatus>('connecting');
	const eventsRef = useRef<MemoryEvent[]>([]);
	const onEventRef = useRef(onEvent);
	onEventRef.current = onEvent;

	useEffect(() => {
		let disposed = false;
		let source: EventSource | null = null;
		let pollTimer: ReturnType<typeof setTimeout> | null = null;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;

		let primed = false;

		const ingest = (incoming: MemoryEvent[]) => {
			if (disposed || incoming.length === 0) return;
			const { events: next, added } = mergeEvents(eventsRef.current, incoming);
			if (added.length === 0) return;
			eventsRef.current = next;
			setEvents(next);
			if (!primed) return;
			for (const event of [...added].reverse()) onEventRef.current(event);
		};

		const poll = async () => {
			try {
				const res = await api.activity({
					sinceId: latestEventId(eventsRef.current),
					limit: INITIAL_LIMIT,
				});
				ingest(res.events ?? []);
				primed = true;
				if (!disposed && !source) setStatus('polling');
			} catch {
				if (!disposed) setStatus('disconnected');
			}
		};

		const startPolling = () => {
			if (pollTimer) return;
			const tick = async () => {
				await poll();
				if (disposed || source) return;
				pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
			};
			pollTimer = setTimeout(tick, 0);
		};

		const stopPolling = () => {
			if (pollTimer) clearTimeout(pollTimer);
			pollTimer = null;
		};

		const connect = () => {
			if (disposed || typeof EventSource === 'undefined') {
				startPolling();
				return;
			}
			const since = latestEventId(eventsRef.current);
			const es = new EventSource(
				since
					? `${api.eventsUrl}?sinceId=${encodeURIComponent(since)}`
					: api.eventsUrl,
			);
			source = es;
			es.addEventListener('open', () => {
				if (disposed) return;
				stopPolling();
				setStatus('live');
				void poll().finally(() => {
					primed = true;
				});
			});
			es.addEventListener('memory', (message) => {
				const event = parseMemoryEvent((message as MessageEvent<string>).data);
				if (event) ingest([event]);
			});
			es.addEventListener('error', () => {
				if (disposed) return;
				es.close();
				source = null;
				setStatus('polling');
				startPolling();
				if (retryTimer) clearTimeout(retryTimer);
				retryTimer = setTimeout(connect, SSE_RETRY_MS);
			});
		};

		void poll().finally(connect);

		return () => {
			disposed = true;
			source?.close();
			stopPolling();
			if (retryTimer) clearTimeout(retryTimer);
		};
	}, []);

	return { events, status, lastEventAt: events[0]?.at ?? null };
}
