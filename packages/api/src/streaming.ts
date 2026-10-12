/**
 * Server-Sent Events (SSE) streaming utilities
 *
 * Provides helpers for connecting to and consuming SSE streams from the otto server.
 */

import { createParser } from 'eventsource-parser';
import {
	clientEventSchema,
	serverEventSchema,
	serverEventTypeSchema,
	replayMissedSchema,
	truncatedPayloadSchema,
	type ReplayMissedPayload,
	type TruncatedStreamPayload,
	type ClientEvent,
	type NotificationAction,
	type NotificationEvent,
	type NotificationLevel,
	type ServerEvent,
	type SessionStatusEvent,
} from '@ottocode/sdk/events/protocol';

export interface SSEEvent {
	id?: string;
	event?: string;
	data: string;
	retry?: number;
}

export type SSERequestMethod = 'GET' | 'POST';
export type SSETransportMode = 'direct' | 'tunnel';

interface SSERequestOptions {
	/** Explicit request method. Overrides transportMode. */
	method?: SSERequestMethod;
	/** Selects GET for direct connections or POST for tunnel compatibility. */
	transportMode?: SSETransportMode;
}

export interface SSEStreamOptions extends SSERequestOptions {
	/**
	 * Base URL of the API server
	 */
	baseUrl: string;

	/**
	 * Session ID to stream events for
	 */
	sessionId: string;

	/**
	 * Project path (optional)
	 */
	projectPath?: string;

	/**
	 * Project id (optional)
	 */
	projectId?: string;

	/**
	 * Custom fetch implementation
	 */
	fetch?: typeof fetch;

	/**
	 * Additional request headers
	 */
	headers?: HeadersInit;

	/**
	 * Callback for each parsed SSE event
	 */
	onEvent: (event: SSEEvent) => void;

	/**
	 * Error handler
	 */
	onError?: (error: Error) => void;

	/**
	 * Connection closed handler
	 */
	onClose?: () => void;
}

export interface ClientEventsStreamOptions extends SSERequestOptions {
	/**
	 * Base URL of the API server
	 */
	baseUrl: string;

	/**
	 * Project path (optional)
	 */
	projectPath?: string;

	/**
	 * Project id (optional)
	 */
	projectId?: string;

	/**
	 * Custom fetch implementation
	 */
	fetch?: typeof fetch;

	/**
	 * Additional request headers
	 */
	headers?: HeadersInit;

	/**
	 * Callback for each parsed SSE event
	 */
	onEvent: (event: SSEEvent) => void;

	/**
	 * Error handler
	 */
	onError?: (error: Error) => void;

	/**
	 * Connection closed handler
	 */
	onClose?: () => void;
}

export function buildSessionStreamUrl(options: {
	baseUrl: string;
	sessionId: string;
	projectPath?: string;
	projectId?: string;
}) {
	const url = new URL(
		`/v1/sessions/${encodeURIComponent(options.sessionId)}/stream`,
		options.baseUrl,
	);
	if (options.projectId) url.searchParams.set('projectId', options.projectId);
	else if (options.projectPath)
		url.searchParams.set('project', options.projectPath);
	return url.toString();
}

export function buildClientEventsStreamUrl(options: {
	baseUrl: string;
	projectPath?: string;
	projectId?: string;
}) {
	const url = new URL('/v1/events/stream', options.baseUrl);
	if (options.projectId) url.searchParams.set('projectId', options.projectId);
	else if (options.projectPath)
		url.searchParams.set('project', options.projectPath);
	return url.toString();
}

/**
 * Build the URL for the multiplexed project event stream. One SSE connection
 * carries every session event for the project plus global client events.
 */
export function buildProjectEventsStreamUrl(options: {
	baseUrl: string;
	projectPath?: string;
	projectId?: string;
	sessionIds?: string[];
}) {
	const url = new URL('/v1/events/project', options.baseUrl);
	if (options.projectId) url.searchParams.set('projectId', options.projectId);
	else if (options.projectPath)
		url.searchParams.set('project', options.projectPath);
	if (options.sessionIds) {
		url.searchParams.set('sessions', options.sessionIds.join(','));
	}
	return url.toString();
}

export interface SSEDecoder {
	feed(chunk: Uint8Array): void;
	flush(): void;
}

/** Frames SSE bytes across UTF-8, line-ending, and network chunk boundaries. */
export function createSSEDecoder(
	onEvent: (event: SSEEvent) => void,
): SSEDecoder {
	const decoder = new TextDecoder();
	const parser = createParser((event) => {
		if (event.type === 'event') {
			onEvent({ id: event.id, event: event.event, data: event.data });
		}
	});
	let trailingCR = false;
	const feedText = (text: string) => {
		if (!text) return;
		// eventsource-parser v2 does not retain its CRLF state between feed calls.
		const normalized =
			trailingCR && text.startsWith('\n') ? text.slice(1) : text;
		trailingCR = normalized.endsWith('\r');
		parser.feed(normalized.replace(/\r\n?/g, '\n'));
	};
	return {
		feed: (chunk) => feedText(decoder.decode(chunk, { stream: true })),
		flush: () => feedText(decoder.decode()),
	};
}

/** Consumes an already-open response; transport and reconnect policy stay with callers. */
export async function consumeSSEResponse(
	response: Response,
	options: {
		onEvent: (event: SSEEvent) => void;
		onChunk?: () => void;
		signal?: AbortSignal;
	},
): Promise<void> {
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(
			`Failed to connect to stream: ${response.status} ${response.statusText}`.trim(),
		);
	}
	if (!response.body) throw new Error('SSE response has no body');
	const decoder = createSSEDecoder(options.onEvent);
	const reader = response.body.getReader();
	const onAbort = () => {
		void reader.cancel().catch(() => undefined);
	};
	options.signal?.addEventListener('abort', onAbort, { once: true });
	if (options.signal?.aborted) onAbort();
	let completed = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				completed = true;
				break;
			}
			options.onChunk?.();
			decoder.feed(value);
		}
		if (!options.signal?.aborted) decoder.flush();
	} finally {
		options.signal?.removeEventListener('abort', onAbort);
		if (!completed) {
			try {
				await reader.cancel();
			} catch {}
		}
		reader.releaseLock();
	}
}

export interface ConsumeSSEOptions extends SSERequestOptions {
	url: string;
	fetch?: typeof fetch;
	headers?: HeadersInit;
	signal?: AbortSignal;
	onEvent: (event: SSEEvent) => void;
}

/** Consumes one SSE response with incremental decoding and deterministic cleanup. */
export async function consumeSSE(options: ConsumeSSEOptions): Promise<void> {
	const response = await (options.fetch ?? fetch)(options.url, {
		method:
			options.method ?? (options.transportMode === 'tunnel' ? 'POST' : 'GET'),
		headers: {
			...options.headers,
			Accept: 'text/event-stream',
		},
		signal: options.signal,
	});
	await consumeSSEResponse(response, options);
}

async function createStreamToUrl(
	options: {
		url: string;
		fetch?: typeof fetch;
		headers?: HeadersInit;
		method?: SSERequestMethod;
		transportMode?: SSETransportMode;
		onEvent: (event: SSEEvent) => void;
		onError?: (error: Error) => void;
		onClose?: () => void;
	},
	signal?: AbortSignal,
): Promise<void> {
	try {
		await consumeSSE({
			url: options.url,
			fetch: options.fetch,
			headers: options.headers,
			method: options.method,
			transportMode: options.transportMode,
			signal,
			onEvent: options.onEvent,
		});
		options.onClose?.();
	} catch (error) {
		if (signal?.aborted) {
			options.onClose?.();
		} else {
			options.onError?.(error as Error);
		}
	}
}

/**
 * Create an SSE stream connection to a session
 *
 * @example
 * ```typescript
 * import { createSSEStream } from '@ottocode/api';
 *
 * const controller = new AbortController();
 *
 * createSSEStream({
 *   baseUrl: 'http://localhost:9100',
 *   sessionId: 'session-123',
 *   onEvent: (event) => {
 *     console.log('Event:', event.event, event.data);
 *     const data = JSON.parse(event.data);
 *     // Handle different event types...
 *   },
 *   onError: (error) => {
 *     console.error('Stream error:', error);
 *   },
 *   onClose: () => {
 *     console.log('Stream closed');
 *   }
 * }, controller.signal);
 *
 * // Later: controller.abort() to close the stream
 * ```
 */
export async function createSSEStream(
	options: SSEStreamOptions,
	signal?: AbortSignal,
): Promise<void> {
	const url = buildSessionStreamUrl({
		baseUrl: options.baseUrl,
		sessionId: options.sessionId,
		projectId: options.projectId,
		projectPath: options.projectPath,
	});

	return createStreamToUrl({ ...options, url }, signal);
}

/**
 * Create an app-level SSE stream connection for global client events.
 */
export async function createClientEventsStream(
	options: ClientEventsStreamOptions,
	signal?: AbortSignal,
): Promise<void> {
	const url = buildClientEventsStreamUrl({
		baseUrl: options.baseUrl,
		projectId: options.projectId,
		projectPath: options.projectPath,
	});

	return createStreamToUrl({ ...options, url }, signal);
}

export type {
	ClientEvent,
	NotificationAction,
	NotificationEvent,
	NotificationLevel,
	ServerEvent,
	SessionStatusEvent,
};

/** Parses the JSON data field from a server session event. */
export function parseServerEvent(
	raw: string | SSEEvent,
	sessionId?: string,
): ServerEvent | null {
	try {
		const value: unknown = JSON.parse(typeof raw === 'string' ? raw : raw.data);
		const record =
			value && typeof value === 'object'
				? (value as Record<string, unknown>)
				: {};
		if (truncatedPayloadSchema.safeParse(value).success) return null;
		const result = serverEventSchema.safeParse(
			typeof raw === 'string'
				? value
				: {
						...(sessionId ? { sessionId } : {}),
						...('payload' in record ? record : { payload: value }),
						type: raw.event ?? record.type,
					},
		);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

/** Parses the JSON data field from a global client event. */
export function parseClientEvent(raw: string | SSEEvent): ClientEvent | null {
	try {
		const value: unknown = JSON.parse(typeof raw === 'string' ? raw : raw.data);
		const record =
			value && typeof value === 'object'
				? (value as Record<string, unknown>)
				: {};
		const result = clientEventSchema.safeParse(
			typeof raw === 'string'
				? value
				: {
						type: raw.event ?? record.type,
						payload: 'payload' in record ? record.payload : value,
					},
		);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}
export type DecodedSSEEvent =
	| ServerEvent
	| ClientEvent
	| {
			type: 'stream.replay.missed';
			payload: ReplayMissedPayload;
	  }
	| {
			type: 'stream.payload.truncated';
			eventType: string;
			sessionId?: string;
			payload: TruncatedStreamPayload;
	  };

/** Decodes payload-only session/client frames and both legacy and typed project envelopes. */
export function decodeSSEEvent(
	event: SSEEvent,
	sessionId?: string,
): DecodedSSEEvent | null {
	try {
		const value: unknown = JSON.parse(event.data);
		const record =
			value && typeof value === 'object'
				? (value as Record<string, unknown>)
				: {};
		if (event.event === 'stream.replay.missed') {
			const parsed = replayMissedSchema.safeParse(record.payload ?? value);
			return parsed.success
				? { type: 'stream.replay.missed', payload: parsed.data }
				: null;
		}
		const truncated = truncatedPayloadSchema.safeParse(value);
		if (truncated.success) {
			return {
				type: 'stream.payload.truncated',
				eventType: event.event ?? 'message',
				sessionId:
					typeof record.sessionId === 'string' ? record.sessionId : sessionId,
				payload: truncated.data,
			};
		}
		if (sessionId || typeof record.sessionId === 'string')
			return parseServerEvent(event, sessionId);
		// Heartbeat is shared by both contracts; without a session it is a client event.
		if (
			serverEventTypeSchema.safeParse(event.event).success &&
			event.event !== 'heartbeat'
		)
			return null;
		return parseClientEvent(event);
	} catch {
		return null;
	}
}

/**
 * Type guard to check if an event is a specific type
 */
export function isServerEvent<T extends ServerEvent['type']>(
	event: unknown,
	type: T,
): event is Extract<ServerEvent, { type: T }> {
	const parsed = serverEventSchema.safeParse(event);
	return parsed.success && parsed.data.type === type;
}

/**
 * Type guard to check if a global client event is a specific type.
 */
export function isClientEvent<T extends ClientEvent['type']>(
	event: unknown,
	type: T,
): event is Extract<ClientEvent, { type: T }> {
	const parsed = clientEventSchema.safeParse(event);
	return parsed.success && parsed.data.type === type;
}
