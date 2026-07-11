import {
	buildClientEventsStreamUrl,
	buildProjectEventsStreamUrl,
	buildSessionStreamUrl,
} from '@ottocode/api';
import type { SSEEvent } from '../types/api';
import {
	getAuthHeaders,
	getBaseUrl,
	getProjectId,
	getProjectRoot,
} from './api-client/utils';
import { hasOwnerRenewalHandler, renewOwnerSession } from './owner-renewal';
import {
	acquireSharedSSEStream,
	SSEClient,
	type SSEConnectionState,
} from './sse-client';

export type StreamEventHandler = (event: SSEEvent) => void;
export type Release = () => void;

export interface StreamHandle {
	on: (handler: StreamEventHandler) => Release;
	release: Release;
}

/**
 * Connection state of the active project's multiplexed SSE stream. Extends
 * the raw client states with `fallback` for older daemons that serve
 * per-stream SSE (each fallback stream manages its own reconnects).
 */
export type ProjectConnectionState =
	| SSEConnectionState
	| { status: 'fallback' };

const IDLE_CONNECTION_STATE: ProjectConnectionState = { status: 'idle' };
const FALLBACK_CONNECTION_STATE: ProjectConnectionState = {
	status: 'fallback',
};

const connectionStateHandlers = new Set<
	(state: ProjectConnectionState) => void
>();

const CLIENT_EVENTS_KEY = '__client_events__';

interface SubscriptionEntry {
	refs: number;
	handlers: Set<StreamEventHandler>;
	/** Active when the multiplexer has fallen back to per-stream SSE. */
	sseRelease: Release | null;
	sseOff: Release | null;
}

/**
 * Multiplexes all session event streams plus the global client-event stream
 * over ONE shared SSE connection per window (`/v1/events/project`).
 *
 * Why: webviews (Tauri/WKWebView, Safari) cap HTTP/1.1 at ~6 connections per
 * host:port origin shared across ALL windows. Before the daemon migration
 * each window talked to its own server port (own pool); with one shared
 * daemon port, per-session SSE connections exhaust the pool after a couple
 * of windows and every regular fetch hangs ("stuck on loading"). One
 * multiplexed SSE connection per window keeps the budget flat regardless of
 * how many sessions are open.
 *
 * The transport stays plain SSE (GET, or POST over tunnels), so tunnels and
 * proxies that already carry the existing streams work unchanged. If the
 * endpoint is unavailable (older daemon), the multiplexer transparently
 * falls back to shared per-stream SSE.
 */
class EventStreamMultiplexer {
	private readonly baseUrl: string;
	private readonly onEmpty: () => void;
	private client: SSEClient | null = null;
	private clientOff: Release | null = null;
	private clientStateOff: Release | null = null;
	private connectionState: ProjectConnectionState = IDLE_CONNECTION_STATE;
	private fallback = false;
	private readonly entries = new Map<string, SubscriptionEntry>();

	constructor(baseUrl: string, onEmpty: () => void) {
		this.baseUrl = baseUrl;
		this.onEmpty = onEmpty;
	}

	acquire(key: string): StreamHandle {
		let entry = this.entries.get(key);
		if (!entry) {
			entry = { refs: 0, handlers: new Set(), sseRelease: null, sseOff: null };
			this.entries.set(key, entry);
			if (this.fallback) {
				this.startFallbackEntry(key, entry);
			} else {
				this.ensureConnection();
			}
		}
		entry.refs += 1;

		let released = false;
		return {
			on: (handler: StreamEventHandler) => {
				entry.handlers.add(handler);
				return () => entry.handlers.delete(handler);
			},
			release: () => {
				if (released) return;
				released = true;
				entry.refs -= 1;
				if (entry.refs <= 0) {
					entry.sseOff?.();
					entry.sseRelease?.();
					entry.sseOff = null;
					entry.sseRelease = null;
					this.entries.delete(key);
					if (this.entries.size === 0) {
						this.teardownConnection();
						this.onEmpty();
					}
				}
			},
		};
	}

	/** Returns the current state of the multiplexed connection. */
	getConnectionState(): ProjectConnectionState {
		return this.connectionState;
	}

	/** Tears down and re-establishes the multiplexed SSE connection. */
	reconnect(): void {
		if (this.fallback || this.entries.size === 0) return;
		this.teardownConnection();
		this.ensureConnection();
	}

	private setConnectionState(state: ProjectConnectionState) {
		if (this.connectionState === state) return;
		this.connectionState = state;
		for (const handler of connectionStateHandlers) handler(state);
	}

	private emit(key: string, event: SSEEvent) {
		const entry = this.entries.get(key);
		if (!entry) return;
		for (const handler of entry.handlers) {
			try {
				handler(event);
			} catch (error) {
				console.error('[event-stream] Handler threw:', error);
			}
		}
	}

	private ensureConnection() {
		if (this.client || this.fallback) return;
		const url = buildProjectEventsStreamUrl({
			baseUrl: this.baseUrl,
			projectId: getProjectId(),
			projectPath: getProjectRoot(),
		});
		const client = new SSEClient();
		this.client = client;
		this.clientStateOff = client.onConnectionState((state) =>
			this.setConnectionState(state),
		);
		this.clientOff = client.on('*', (event) => {
			const data = event.payload as
				| { sessionId?: string; payload?: unknown }
				| undefined;
			const payload = (data?.payload ?? {}) as Record<string, unknown>;
			if (data && typeof data.sessionId === 'string') {
				this.emit(data.sessionId, { type: event.type, payload });
			} else {
				this.emit(CLIENT_EVENTS_KEY, { type: event.type, payload });
			}
		});
		void client.connect(url, undefined, {
			getHeaders: getAuthHeaders,
			onUnauthorized: async () => {
				await renewOwnerSession();
			},
			onHttpError: (status) => {
				if (status === 404 || status === 405) {
					// Older daemon without /v1/events/project: use per-stream SSE.
					this.enterFallback();
					return false;
				}
				return true;
			},
		});
	}

	private teardownConnection() {
		this.clientOff?.();
		this.clientOff = null;
		this.clientStateOff?.();
		this.clientStateOff = null;
		this.client?.disconnect();
		this.client = null;
		this.setConnectionState(IDLE_CONNECTION_STATE);
	}

	private enterFallback() {
		if (this.fallback) return;
		this.fallback = true;
		console.warn(
			'[event-stream] Project event stream unavailable, falling back to per-stream SSE',
		);
		this.teardownConnection();
		this.setConnectionState(FALLBACK_CONNECTION_STATE);
		this.emit(CLIENT_EVENTS_KEY, { type: 'stream.fallback', payload: {} });
		for (const [key, entry] of this.entries) {
			this.startFallbackEntry(key, entry);
		}
	}

	private startFallbackEntry(key: string, entry: SubscriptionEntry) {
		if (entry.sseRelease) return;
		const url =
			key === CLIENT_EVENTS_KEY
				? buildClientEventsStreamUrl({
						baseUrl: this.baseUrl,
						projectId: getProjectId(),
						projectPath: getProjectRoot(),
					})
				: buildSessionStreamUrl({
						baseUrl: this.baseUrl,
						sessionId: key,
						projectId: getProjectId(),
						projectPath: getProjectRoot(),
					});
		const { client, release } = acquireSharedSSEStream(url, undefined, {
			getHeaders: getAuthHeaders,
			onUnauthorized: async () => {
				await renewOwnerSession();
			},
		});
		entry.sseRelease = release;
		entry.sseOff = client.on('*', (event) => this.emit(key, event));
	}
}

const multiplexers = new Map<string, EventStreamMultiplexer>();

function getMultiplexerKey(): string {
	const projectKey = getProjectId() ?? getProjectRoot() ?? '';
	return `${getBaseUrl()}::${projectKey}`;
}

function getMultiplexer(): EventStreamMultiplexer {
	const cacheKey = getMultiplexerKey();
	let mux = multiplexers.get(cacheKey);
	if (!mux) {
		const created = new EventStreamMultiplexer(getBaseUrl(), () => {
			if (multiplexers.get(cacheKey) === created) {
				multiplexers.delete(cacheKey);
			}
		});
		multiplexers.set(cacheKey, created);
		mux = created;
	}
	return mux;
}

/**
 * Subscribe to a session's event stream over the shared multiplexed
 * connection. Multiple subscribers for the same session share one
 * subscription; all sessions share one SSE connection per window.
 */
export function acquireSessionEventStream(sessionId: string): StreamHandle {
	return getMultiplexer().acquire(sessionId);
}

/**
 * Subscribe to global client events (notifications, session status) over the
 * shared multiplexed connection.
 */
export function acquireClientEventStream(): StreamHandle {
	return getMultiplexer().acquire(CLIENT_EVENTS_KEY);
}

/** Returns the active project's multiplexed SSE connection state. */
export function getProjectConnectionState(): ProjectConnectionState {
	return (
		multiplexers.get(getMultiplexerKey())?.getConnectionState() ??
		IDLE_CONNECTION_STATE
	);
}

/**
 * Subscribes to connection state changes of any project multiplexer. Pair
 * with {@link getProjectConnectionState} to read the active project's state.
 */
export function onProjectConnectionState(
	handler: (state: ProjectConnectionState) => void,
): Release {
	connectionStateHandlers.add(handler);
	return () => {
		connectionStateHandlers.delete(handler);
	};
}

/**
 * Runs the full recovery path for the active project's event connection:
 * renews the remote owner session when a renewal broker is installed, then
 * re-establishes the multiplexed SSE connection.
 */
export async function retryProjectConnection(): Promise<void> {
	if (hasOwnerRenewalHandler()) {
		await renewOwnerSession();
	}
	multiplexers.get(getMultiplexerKey())?.reconnect();
}
