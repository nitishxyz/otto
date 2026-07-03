/**
 * Server-Sent Events (SSE) streaming utilities
 *
 * Provides helpers for connecting to and consuming SSE streams from the otto server.
 */

import { createParser } from 'eventsource-parser';

export interface SSEEvent {
	id?: string;
	event?: string;
	data: string;
	retry?: number;
}

export interface SSEStreamOptions {
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

export interface ClientEventsStreamOptions {
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
}) {
	const url = new URL('/v1/events/project', options.baseUrl);
	if (options.projectId) url.searchParams.set('projectId', options.projectId);
	else if (options.projectPath)
		url.searchParams.set('project', options.projectPath);
	return url.toString();
}

async function createStreamToUrl(
	options: {
		baseUrl: string;
		url: string;
		fetch?: typeof fetch;
		headers?: HeadersInit;
		onEvent: (event: SSEEvent) => void;
		onError?: (error: Error) => void;
		onClose?: () => void;
	},
	signal?: AbortSignal,
): Promise<void> {
	const {
		baseUrl,
		url,
		fetch: customFetch,
		headers,
		onEvent,
		onError,
		onClose,
	} = options;
	const fetchImpl = customFetch || fetch;

	const isTunnel =
		!baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1');

	try {
		const response = await fetchImpl(url, {
			method: isTunnel ? 'POST' : 'GET',
			headers: {
				...headers,
				Accept: 'text/event-stream',
			},
			signal,
		});

		if (!response.ok) {
			throw new Error(`Failed to connect to stream: ${response.statusText}`);
		}

		if (!response.body) {
			throw new Error('Response body is null');
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();

		// Create SSE parser
		const parser = createParser((event) => {
			if (event.type === 'event') {
				onEvent({
					id: event.id,
					event: event.event,
					data: event.data,
				});
			}
		});

		// Read stream
		try {
			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					onClose?.();
					break;
				}

				const chunk = decoder.decode(value, { stream: true });
				parser.feed(chunk);
			}
		} finally {
			reader.releaseLock();
		}
	} catch (error) {
		if (signal?.aborted) {
			onClose?.();
		} else {
			onError?.(error as Error);
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

/**
 * Parse a single SSE event string
 *
 * Useful for testing or custom SSE implementations.
 */
export function parseSSEEvent(eventString: string): SSEEvent | null {
	const lines = eventString.split('\n');
	const event: Partial<SSEEvent> = {};

	for (const line of lines) {
		if (line.startsWith('id:')) {
			event.id = line.slice(3).trim();
		} else if (line.startsWith('event:')) {
			event.event = line.slice(6).trim();
		} else if (line.startsWith('data:')) {
			event.data = line.slice(5).trim();
		} else if (line.startsWith('retry:')) {
			const retry = Number.parseInt(line.slice(6).trim(), 10);
			if (!Number.isNaN(retry)) {
				event.retry = retry;
			}
		}
	}

	return event.data ? (event as SSEEvent) : null;
}

/**
 * Event type definitions for otto server SSE events
 */
export type ServerEvent =
	| SessionCreatedEvent
	| MessageCreatedEvent
	| MessagePartDeltaEvent
	| ToolCallEvent
	| ToolDeltaEvent
	| ToolResultEvent
	| MessageCompletedEvent
	| ErrorEvent;

export interface SessionCreatedEvent {
	type: 'session.created';
	sessionId: string;
	agent: string;
	provider: string;
	model: string;
}

export interface MessageCreatedEvent {
	type: 'message.created';
	messageId: string;
	role: 'user' | 'assistant';
}

export interface MessagePartDeltaEvent {
	type: 'message.part.delta';
	partId: string;
	delta: string;
}

export interface ToolCallEvent {
	type: 'tool.call';
	toolCallId: string;
	toolName: string;
	args: unknown;
}

export interface ToolDeltaEvent {
	type: 'tool.delta';
	toolCallId: string;
	delta: string;
}

export interface ToolResultEvent {
	type: 'tool.result';
	toolCallId: string;
	result: unknown;
	artifact?: unknown;
}

export interface MessageCompletedEvent {
	type: 'message.completed';
	messageId: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	finishReason?: string;
	rawFinishReason?: string;
}

export interface ErrorEvent {
	type: 'error';
	error: string;
}

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotificationAction {
	label: string;
	href: string;
}

export interface NotificationEvent {
	id: string;
	level: NotificationLevel;
	title: string;
	body?: string;
	action?: NotificationAction;
	createdAt: string;
	expiresAt?: string;
	source?: 'agent' | 'system' | 'session' | 'auth' | 'billing';
	sessionId?: string;
}

export interface SessionStatusEvent {
	sessionId: string;
	status: 'running' | 'completed' | 'failed' | 'needs_attention';
	messageId?: string;
	createdAt: string;
}

export type ClientEvent =
	| { type: 'notification'; payload: NotificationEvent }
	| { type: 'session.status'; payload: SessionStatusEvent }
	| { type: 'heartbeat'; payload: { createdAt: string } };

/**
 * Type guard to check if an event is a specific type
 */
export function isServerEvent<T extends ServerEvent['type']>(
	event: unknown,
	type: T,
): event is Extract<ServerEvent, { type: T }> {
	return (
		typeof event === 'object' &&
		event !== null &&
		'type' in event &&
		event.type === type
	);
}

/**
 * Type guard to check if a global client event is a specific type.
 */
export function isClientEvent<T extends ClientEvent['type']>(
	event: unknown,
	type: T,
): event is Extract<ClientEvent, { type: T }> {
	return (
		typeof event === 'object' &&
		event !== null &&
		'type' in event &&
		event.type === type
	);
}
