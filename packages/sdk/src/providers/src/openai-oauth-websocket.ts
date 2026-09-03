const CODEX_RESPONSES_WEBSOCKET_URL =
	'wss://chatgpt.com/backend-api/codex/responses';
const CODEX_RESPONSES_WEBSOCKET_BETA = 'responses_websockets=2026-02-06';
const WEBSOCKET_OPEN = 1;
const WEBSOCKET_IDLE_CLOSE_MS = 5 * 60 * 1000;

export type OpenAIOAuthTransport = 'auto' | 'websocket' | 'http';

export type OpenAIOAuthWebSocketFactory = (
	url: string,
	options: { headers: Record<string, string> },
) => WebSocket;

export type CodexWebSocketRequest = {
	body: string;
	headers: Headers;
	signal?: AbortSignal | null;
	sessionId?: string;
};

export type CodexWebSocketTransportOptions = {
	connectTimeoutMs: () => number;
	idleTimeoutMs: () => number;
	persistConnection?: boolean;
	webSocketFactory?: OpenAIOAuthWebSocketFactory;
	onStreamFailure?: (error: Error) => void;
};

function defaultWebSocketFactory(
	url: string,
	options: { headers: Record<string, string> },
) {
	return new WebSocket(url, options);
}

function errorFromUnknown(error: unknown, fallback: string) {
	if (error instanceof Error) return error;
	return new Error(typeof error === 'string' ? error : fallback);
}

function abortError(signal: AbortSignal) {
	return errorFromUnknown(
		signal.reason,
		'OpenAI OAuth Codex WebSocket request aborted',
	);
}

function websocketCloseError(event: CloseEvent) {
	const suffix = [event.code ? `code=${event.code}` : '', event.reason]
		.filter(Boolean)
		.join(' ');
	return new Error(
		`OpenAI OAuth Codex WebSocket closed before response.completed${suffix ? ` (${suffix})` : ''}`,
	);
}

function websocketEventError(payload: string) {
	try {
		const parsed = JSON.parse(payload) as {
			error?: { code?: string; message?: string };
			status?: number;
			status_code?: number;
		};
		const status = parsed.status ?? parsed.status_code;
		const detail = parsed.error?.message ?? parsed.error?.code;
		return new Error(
			`OpenAI OAuth Codex WebSocket error${status ? ` (${status})` : ''}${detail ? `: ${detail}` : ''}`,
		);
	} catch {
		return new Error('OpenAI OAuth Codex WebSocket returned an error event');
	}
}

function connectionIdentity(headers: Headers) {
	return [
		headers.get('authorization') ?? '',
		headers.get('chatgpt-account-id') ?? '',
	].join('\n');
}

function websocketHeaders(headers: Headers) {
	const result: Record<string, string> = {};
	for (const [name, value] of headers) {
		if (
			name === 'accept' ||
			name === 'content-length' ||
			name === 'content-type'
		) {
			continue;
		}
		result[name] = value;
	}
	result['openai-beta'] = CODEX_RESPONSES_WEBSOCKET_BETA;
	result['x-client-request-id'] = crypto.randomUUID();
	return result;
}

function websocketFrame(body: string, sessionId?: string) {
	const parsed = JSON.parse(body) as Record<string, unknown>;
	const clientMetadata =
		parsed.client_metadata &&
		typeof parsed.client_metadata === 'object' &&
		!Array.isArray(parsed.client_metadata)
			? { ...(parsed.client_metadata as Record<string, unknown>) }
			: {};
	if (sessionId && typeof clientMetadata.session_id !== 'string') {
		clientMetadata.session_id = sessionId;
	}
	return JSON.stringify({
		...parsed,
		type: 'response.create',
		...(Object.keys(clientMetadata).length > 0
			? { client_metadata: clientMetadata }
			: {}),
	});
}

export function isCodexWebSocketRequest(body: unknown): body is string {
	if (typeof body !== 'string') return false;
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		return parsed.stream === true && parsed.store === false;
	} catch {
		return false;
	}
}

export function resolveOpenAIOAuthTransport(
	configured?: OpenAIOAuthTransport,
): OpenAIOAuthTransport {
	if (configured) return configured;
	const value = process.env.OTTO_OPENAI_OAUTH_TRANSPORT?.trim().toLowerCase();
	return value === 'http' || value === 'websocket' || value === 'auto'
		? value
		: 'auto';
}

export class CodexWebSocketTransport {
	readonly #options: CodexWebSocketTransportOptions;
	#socket: WebSocket | undefined;
	#connecting: Promise<WebSocket> | undefined;
	#identity: string | undefined;
	#active = false;
	#idleCloseTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(options: CodexWebSocketTransportOptions) {
		this.#options = options;
	}

	close() {
		this.#clearIdleClose();
		const socket = this.#socket;
		this.#socket = undefined;
		this.#identity = undefined;
		this.#connecting = undefined;
		this.#active = false;
		if (socket && socket.readyState < WebSocket.CLOSING) {
			try {
				socket.close(1000, 'Otto transport closed');
			} catch {
				// best-effort cleanup
			}
		}
	}

	async request(request: CodexWebSocketRequest): Promise<Response> {
		if (request.signal?.aborted) throw abortError(request.signal);
		const socket = await this.#connect(request.headers, request.signal);
		if (this.#active) {
			throw new Error(
				'OpenAI OAuth Codex WebSocket already has an active response',
			);
		}

		this.#active = true;
		this.#clearIdleClose();
		try {
			return await this.#startRequest(socket, request);
		} catch (error) {
			this.#active = false;
			this.#invalidate(socket);
			throw error;
		}
	}

	async #connect(headers: Headers, signal?: AbortSignal | null) {
		const identity = connectionIdentity(headers);
		if (
			this.#socket?.readyState === WEBSOCKET_OPEN &&
			this.#identity === identity
		) {
			return this.#socket;
		}

		if (this.#socket && this.#identity !== identity) this.close();
		if (this.#connecting) return await this.#connecting;

		const factory = this.#options.webSocketFactory ?? defaultWebSocketFactory;
		this.#identity = identity;
		this.#connecting = new Promise<WebSocket>((resolve, reject) => {
			let socket: WebSocket;
			try {
				socket = factory(CODEX_RESPONSES_WEBSOCKET_URL, {
					headers: websocketHeaders(headers),
				});
			} catch (error) {
				reject(
					errorFromUnknown(
						error,
						'Failed to create OpenAI OAuth Codex WebSocket',
					),
				);
				return;
			}

			this.#socket = socket;
			const cleanup = () => {
				clearTimeout(timeout);
				socket.removeEventListener('open', onOpen);
				socket.removeEventListener('error', onError);
				socket.removeEventListener('close', onClose);
				signal?.removeEventListener('abort', onAbort);
			};
			const fail = (error: Error) => {
				cleanup();
				this.#invalidate(socket);
				reject(error);
			};
			const onOpen = () => {
				cleanup();
				resolve(socket);
			};
			const onError = () =>
				fail(new Error('Failed to connect OpenAI OAuth Codex WebSocket'));
			const onClose = (event: CloseEvent) => fail(websocketCloseError(event));
			const onAbort = () => fail(abortError(signal as AbortSignal));
			const timeout = setTimeout(
				() =>
					fail(
						new Error(
							`OpenAI OAuth Codex WebSocket connect timeout after ${this.#options.connectTimeoutMs()}ms`,
						),
					),
				this.#options.connectTimeoutMs(),
			);

			socket.addEventListener('open', onOpen);
			socket.addEventListener('error', onError);
			socket.addEventListener('close', onClose);
			signal?.addEventListener('abort', onAbort, { once: true });
		});

		try {
			return await this.#connecting;
		} finally {
			this.#connecting = undefined;
		}
	}

	async #startRequest(socket: WebSocket, request: CodexWebSocketRequest) {
		const encoder = new TextEncoder();
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		let idleTimer: ReturnType<typeof setTimeout> | undefined;
		let settled = false;
		let responseStarted = false;
		let resolveStarted!: () => void;
		let rejectStarted!: (error: Error) => void;
		const started = new Promise<void>((resolve, reject) => {
			resolveStarted = resolve;
			rejectStarted = reject;
		});

		const cleanup = () => {
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = undefined;
			socket.removeEventListener('message', onMessage);
			socket.removeEventListener('error', onError);
			socket.removeEventListener('close', onClose);
			request.signal?.removeEventListener('abort', onAbort);
		};
		const markStarted = () => {
			if (responseStarted) return;
			responseStarted = true;
			resolveStarted();
		};
		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			this.#active = false;
			this.#invalidate(socket);
			if (!request.signal?.aborted) this.#options.onStreamFailure?.(error);
			try {
				controller.error(error);
			} catch {
				// stream was already cancelled
			}
			if (!responseStarted) rejectStarted(error);
		};
		const finish = () => {
			if (settled) return;
			settled = true;
			cleanup();
			this.#active = false;
			controller.enqueue(encoder.encode('data: [DONE]\n\n'));
			controller.close();
			markStarted();
			if (this.#options.persistConnection) {
				this.#scheduleIdleClose(socket);
			} else {
				this.close();
			}
		};
		const resetIdleTimer = () => {
			if (idleTimer) clearTimeout(idleTimer);
			const timeoutMs = this.#options.idleTimeoutMs();
			idleTimer = setTimeout(
				() =>
					fail(
						new Error(
							`OpenAI OAuth Codex WebSocket stream idle timeout after ${timeoutMs}ms`,
						),
					),
				timeoutMs,
			);
		};
		const onMessage = (event: MessageEvent) => {
			if (settled) return;
			if (typeof event.data !== 'string') {
				fail(new Error('OpenAI OAuth Codex WebSocket returned binary data'));
				return;
			}

			resetIdleTimer();
			let type: string | undefined;
			try {
				type = (JSON.parse(event.data) as { type?: unknown }).type as
					| string
					| undefined;
			} catch {
				fail(new Error('OpenAI OAuth Codex WebSocket returned invalid JSON'));
				return;
			}
			if (type === 'error') {
				fail(websocketEventError(event.data));
				return;
			}

			controller.enqueue(encoder.encode(`data: ${event.data}\n\n`));
			if (
				type === 'response.created' ||
				type === 'response.output_text.delta' ||
				type === 'response.completed' ||
				type === 'response.incomplete' ||
				type === 'response.failed'
			) {
				markStarted();
			}
			if (
				type === 'response.completed' ||
				type === 'response.incomplete' ||
				type === 'response.failed'
			) {
				finish();
			}
		};
		const onError = () =>
			fail(new Error('OpenAI OAuth Codex WebSocket stream failed'));
		const onClose = (event: CloseEvent) => fail(websocketCloseError(event));
		const onAbort = () => fail(abortError(request.signal as AbortSignal));

		const body = new ReadableStream<Uint8Array>({
			start(streamController) {
				controller = streamController;
			},
			cancel: () => {
				if (settled) return;
				settled = true;
				cleanup();
				this.#active = false;
				this.#invalidate(socket);
			},
		});
		socket.addEventListener('message', onMessage);
		socket.addEventListener('error', onError);
		socket.addEventListener('close', onClose);
		request.signal?.addEventListener('abort', onAbort, { once: true });
		resetIdleTimer();

		try {
			socket.send(websocketFrame(request.body, request.sessionId));
		} catch (error) {
			fail(
				errorFromUnknown(
					error,
					'Failed to send OpenAI OAuth Codex WebSocket request',
				),
			);
		}

		await started;
		return new Response(body, {
			status: 200,
			headers: {
				'content-type': 'text/event-stream',
				'x-otto-openai-transport': 'websocket',
			},
		});
	}

	#invalidate(socket: WebSocket) {
		if (this.#socket !== socket) return;
		this.#socket = undefined;
		this.#identity = undefined;
		try {
			if (socket.readyState < WebSocket.CLOSING) {
				socket.close(1011, 'Otto reconnecting transport');
			}
		} catch {
			// best-effort cleanup
		}
	}

	#clearIdleClose() {
		if (this.#idleCloseTimer) clearTimeout(this.#idleCloseTimer);
		this.#idleCloseTimer = undefined;
	}

	#scheduleIdleClose(socket: WebSocket) {
		this.#clearIdleClose();
		this.#idleCloseTimer = setTimeout(() => {
			if (!this.#active && this.#socket === socket) this.close();
		}, WEBSOCKET_IDLE_CLOSE_MS);
	}
}
