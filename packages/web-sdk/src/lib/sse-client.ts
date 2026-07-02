import type { SSEEvent } from '../types/api';

export type SSEEventHandler = (event: SSEEvent) => void;

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

export class SSEClient {
	private abortController: AbortController | null = null;
	private handlers: Map<string, Set<SSEEventHandler>> = new Map();
	private running = false;

	async connect(url: string, headers?: HeadersInit) {
		if (this.abortController) {
			this.abortController.abort();
		}

		this.abortController = new AbortController();
		this.running = true;
		const signal = this.abortController.signal;
		let attempt = 0;

		while (this.running && !signal.aborted) {
			const receivedData = await this.streamOnce(url, headers, signal);
			if (!this.running || signal.aborted) break;

			attempt = receivedData ? 0 : attempt + 1;
			const delay = Math.min(
				RECONNECT_BASE_DELAY_MS * 2 ** attempt,
				RECONNECT_MAX_DELAY_MS,
			);
			console.warn(`[SSE] Stream ended, reconnecting in ${delay}ms`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	private async streamOnce(
		url: string,
		headers: HeadersInit | undefined,
		signal: AbortSignal,
	): Promise<boolean> {
		const isTunnel = !url.includes('localhost') && !url.includes('127.0.0.1');
		let receivedData = false;

		try {
			const response = await fetch(url, {
				method: isTunnel ? 'POST' : 'GET',
				headers: { ...headers, Accept: 'text/event-stream' },
				signal,
			});

			if (!response.ok) {
				console.error('[SSE] Connection failed:', response.status);
				return receivedData;
			}

			const reader = response.body?.getReader();
			if (!reader) {
				console.error('[SSE] No response body');
				return receivedData;
			}

			const decoder = new TextDecoder();
			let buffer = '';

			while (this.running) {
				const { done, value } = await reader.read();
				if (done) break;
				receivedData = true;

				buffer += decoder.decode(value, { stream: true });
				let idx = buffer.indexOf('\n\n');

				while (idx !== -1) {
					const raw = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					const lines = raw.split('\n');

					let eventType = 'message';
					let data = '';

					for (const line of lines) {
						if (line.startsWith('event: ')) {
							eventType = line.slice(7).trim();
						} else if (line.startsWith('data: ')) {
							data += (data ? '\n' : '') + line.slice(6);
						} else if (line.startsWith(':')) {
						}
					}

					if (data) {
						try {
							const payload = JSON.parse(data);
							this.emit({ type: eventType, payload });
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
		}
		return receivedData;
	}

	disconnect() {
		this.running = false;
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
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
