/**
 * Server-Sent Events (SSE) streaming utilities
 *
 * Provides helpers for connecting to and consuming SSE streams from the otto server.
 */

import { createParser } from 'eventsource-parser';
import {
	clientEventSchema,
	serverEventSchema,
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
	if (!response.ok) {
		throw new Error(
			`Failed to connect to stream: ${response.status} ${response.statusText}`.trim(),
		);
	}
	if (!response.body) throw new Error('SSE response has no body');

	const parser = createParser((event) => {
		if (event.type !== 'event') return;
		options.onEvent({
			id: event.id,
			event: event.event,
			data: event.data,
		});
	});
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let completed = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				completed = true;
				break;
			}
			parser.feed(decoder.decode(value, { stream: true }));
		}
		parser.feed(decoder.decode());
	} finally {
		if (!completed) {
			try {
				await reader.cancel();
			} catch {}
		}
		reader.releaseLock();
	}
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
export function parseServerEvent(raw: string): ServerEvent | null {
	try {
		const result = serverEventSchema.safeParse(JSON.parse(raw));
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

/** Parses the JSON data field from a global client event. */
export function parseClientEvent(raw: string): ClientEvent | null {
	try {
		const result = clientEventSchema.safeParse(JSON.parse(raw));
		return result.success ? result.data : null;
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
