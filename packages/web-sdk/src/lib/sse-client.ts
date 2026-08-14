import type { SSEEvent } from '../types/api';

export type SSEEventHandler = (event: SSEEvent) => void;
export type SSEConnectionState =
	| { status: 'idle' }
	| { status: 'connecting'; attempt: number }
	| { status: 'connected' }
	| { status: 'retrying'; attempt: number; delay: number; httpStatus?: number };

export interface SSEConnectOptions {
	/**
	 * Called when the server answers with a non-OK HTTP status. Return false
	 * to stop reconnecting (e.g. 404 from an older daemon that lacks the
	 * endpoint); return true (default) to keep retrying.
	 */
	onHttpError?: (status: number) => boolean;
	/** Supplies credentials immediately before every connection attempt. */
	getHeaders?: () => HeadersInit;
	/** Renews credentials after a 401. Concurrent renewal should be deduplicated. */
	onUnauthorized?: () => Promise<void>;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
// Server sends `: hb` comments every 5s; if nothing arrives for this long the
// connection is stalled (half-dead socket, paused webview) and must be dropped.
const STALL_TIMEOUT_MS = 20000;
const STALL_CHECK_INTERVAL_MS = 5000;

export class SSEClient {
	private abortController: AbortController | null = null;
	private handlers: Map<string, Set<SSEEventHandler>> = new Map();
	private stateHandlers = new Set<(state: SSEConnectionState) => void>();
	private running = false;
	private state: SSEConnectionState = { status: 'idle' };
	private lastEventId: string | undefined;

	async connect(url: string, headers?: HeadersInit, opts?: SSEConnectOptions) {
		if (this.abortController) {
			this.abortController.abort();
		}

		this.abortController = new AbortController();
		this.running = true;
		const signal = this.abortController.signal;
		let attempt = 0;

		while (this.running && !signal.aborted) {
			this.setState({ status: 'connecting', attempt });
			const receivedData = await this.streamOnce(url, headers, signal, opts);
			if (!this.running || signal.aborted) break;

			attempt = receivedData ? 0 : attempt + 1;
			const delay = Math.min(
				RECONNECT_BASE_DELAY_MS * 2 ** attempt,
				RECONNECT_MAX_DELAY_MS,
			);
			this.setState({ status: 'retrying', attempt, delay });
			console.warn(`[SSE] Stream ended, reconnecting in ${delay}ms`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	private async streamOnce(
		url: string,
		headers: HeadersInit | undefined,
		signal: AbortSignal,
		opts?: SSEConnectOptions,
	): Promise<boolean> {
		const isTunnel = !url.includes('localhost') && !url.includes('127.0.0.1');
		let receivedData = false;
		const attempt = new AbortController();
		const onOuterAbort = () => attempt.abort();
		signal.addEventListener('abort', onOuterAbort, { once: true });
		let lastByteAt = Date.now();
		const watchdog = setInterval(() => {
			if (Date.now() - lastByteAt > STALL_TIMEOUT_MS) {
				console.warn('[SSE] No data received, dropping stalled connection');
				attempt.abort();
			}
		}, STALL_CHECK_INTERVAL_MS);

		try {
			const requestHeaders = new Headers(headers);
			const refreshedHeaders = new Headers(opts?.getHeaders?.());
			for (const [name, value] of refreshedHeaders) {
				requestHeaders.set(name, value);
			}
			requestHeaders.set('Accept', 'text/event-stream');
			if (this.lastEventId) {
				requestHeaders.set('Last-Event-ID', this.lastEventId);
			}
			const response = await fetch(url, {
				method: isTunnel ? 'POST' : 'GET',
				headers: requestHeaders,
				signal: attempt.signal,
			});

			if (!response.ok) {
				console.error('[SSE] Connection failed:', response.status);
				if (response.status === 401 && opts?.onUnauthorized) {
					await opts.onUnauthorized();
				}
				if (opts?.onHttpError && opts.onHttpError(response.status) === false) {
					this.running = false;
				}
				return receivedData;
			}

			const reader = response.body?.getReader();
			if (!reader) {
				console.error('[SSE] No response body');
				return receivedData;
			}
			this.setState({ status: 'connected' });

			const decoder = new TextDecoder();
			let buffer = '';

			while (this.running) {
				const { done, value } = await reader.read();
				if (done) break;
				receivedData = true;
				lastByteAt = Date.now();

				buffer += decoder.decode(value, { stream: true });
				let idx = buffer.indexOf('\n\n');

				while (idx !== -1) {
					const raw = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					const lines = raw.split('\n');

					let eventType = 'message';
					let data = '';
					let eventId: string | undefined;

					for (const line of lines) {
						if (line.startsWith('event: ')) {
							eventType = line.slice(7).trim();
						} else if (line.startsWith('id:')) {
							eventId = line.slice(3).trim();
						} else if (line.startsWith('data: ')) {
							data += (data ? '\n' : '') + line.slice(6);
						} else if (line.startsWith(':')) {
						}
					}

					if (data) {
						try {
							const payload = JSON.parse(data);
							if (eventId) this.lastEventId = eventId;
							this.emit({ id: eventId, type: eventType, payload });
						} catch (error) {
							console.error(`[SSE] Failed to parse ${eventType}:`, error);
						}
					}

					idx = buffer.indexOf('\n\n');
				}
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
			} else if (
				error instanceof TypeError &&
				error.message === 'Load failed'
			) {
			} else {
				console.error('[SSE] Connection error:', error);
			}
		} finally {
			clearInterval(watchdog);
			signal.removeEventListener('abort', onOuterAbort);
		}
		return receivedData;
	}

	disconnect() {
		this.running = false;
		this.setState({ status: 'idle' });
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
	}

	/** Returns the current connection state for external-store consumers. */
	getConnectionState(): SSEConnectionState {
		return this.state;
	}

	getLastEventId(): string | undefined {
		return this.lastEventId;
	}

	setLastEventId(lastEventId: string | undefined): void {
		this.lastEventId = lastEventId;
	}

	/** Subscribes to connection/retry state changes. */
	onConnectionState(handler: (state: SSEConnectionState) => void): () => void {
		this.stateHandlers.add(handler);
		return () => this.stateHandlers.delete(handler);
	}

	private setState(state: SSEConnectionState): void {
		this.state = state;
		for (const handler of this.stateHandlers) handler(state);
	}

	on(eventType: string, handler: SSEEventHandler) {
		if (!this.handlers.has(eventType)) {
			this.handlers.set(eventType, new Set());
		}
		this.handlers.get(eventType)?.add(handler);

		return () => {
			this.off(eventType, handler);
		};
	}

	off(eventType: string, handler: SSEEventHandler) {
		const handlers = this.handlers.get(eventType);
		if (handlers) {
			handlers.delete(handler);
			if (handlers.size === 0) {
				this.handlers.delete(eventType);
			}
		}
	}

	private emit(event: SSEEvent) {
		const handlers = this.handlers.get(event.type);
		if (handlers) {
			for (const handler of handlers) {
				handler(event);
			}
		}

		const allHandlers = this.handlers.get('*');
		if (allHandlers) {
			for (const handler of allHandlers) {
				handler(event);
			}
		}
	}
}

interface SharedStreamEntry {
	client: SSEClient;
	refs: number;
}

const sharedStreams = new Map<string, SharedStreamEntry>();

/**
 * Acquire a shared SSE connection for a stream URL.
 *
 * Multiple subscribers (message thread, floating viewers, looper panes) for
 * the same session reuse ONE underlying connection instead of opening their
 * own. This matters in webviews (Tauri/WKWebView) where HTTP/1.1 allows only
 * ~6 connections per host across all windows: unbounded SSE connections
 * starve regular fetches and the UI appears stuck loading.
 *
 * Returns the client plus a release function. The connection closes when the
 * last subscriber releases it.
 */
export function acquireSharedSSEStream(
	url: string,
	headers?: HeadersInit,
	opts?: SSEConnectOptions,
): { client: SSEClient; release: () => void } {
	let entry = sharedStreams.get(url);
	if (!entry) {
		const client = new SSEClient();
		void client.connect(url, headers, opts);
		entry = { client, refs: 0 };
		sharedStreams.set(url, entry);
	}
	entry.refs += 1;

	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		const current = sharedStreams.get(url);
		if (!current) return;
		current.refs -= 1;
		if (current.refs <= 0) {
			sharedStreams.delete(url);
			current.client.disconnect();
		}
	};

	return { client: entry.client, release };
}
