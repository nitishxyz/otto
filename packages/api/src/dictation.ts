import { createParser } from 'eventsource-parser';
import type {
	CreateDictationSessionResponse,
	GetDictationStatusResponse,
	InstallDictationModelResponse,
} from './generated/types.gen';

export const DICTATION_AUDIO_FORMAT = {
	encoding: 'pcm_s16le',
	sampleRate: 16_000,
	channels: 1,
} as const;

export type DictationStatus = GetDictationStatusResponse;
export type DictationModelState = DictationStatus['models'][number];
export type DictationSession = CreateDictationSessionResponse;
export type DictationModelInstallResponse = InstallDictationModelResponse;

export type DictationServerEvent =
	| {
			type: 'ready';
			sessionId: string;
			model: string;
			format: typeof DICTATION_AUDIO_FORMAT;
	  }
	| {
			type: 'recording';
			receivedMs: number;
			receivedBytes: number;
	  }
	| {
			type: 'final';
			text: string;
			language: string;
			model: string;
			durationMs: number;
	  }
	| {
			type: 'error';
			code: string;
			message: string;
	  };

export type DictationFinalEvent = Extract<
	DictationServerEvent,
	{ type: 'final' }
>;

export interface DictationWebSocketLike {
	readonly readyState: number;
	binaryType: BinaryType;
	onopen: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	send(data: string | ArrayBufferLike | ArrayBufferView): void;
	close(code?: number, reason?: string): void;
}

export type DictationWebSocketFactory = (url: string) => DictationWebSocketLike;

export interface ConnectDictationSessionOptions {
	session: DictationSession;
	baseUrl?: string;
	language?: string;
	partialResults?: boolean;
	timeoutMs?: number;
	webSocketFactory?: DictationWebSocketFactory;
	onEvent?: (event: DictationServerEvent) => void;
}

export interface DictationConnection {
	readonly sessionId: string;
	readonly model: string;
	sendAudio(frame: Uint8Array): void;
	stop(): Promise<DictationFinalEvent>;
	cancel(): void;
	close(): void;
}

export interface StreamDictationModelInstallOptions {
	baseUrl: string;
	model: string;
	headers?: HeadersInit;
	signal?: AbortSignal;
	fetch?: typeof fetch;
	onModel: (model: DictationModelState) => void;
}

/** Resolves a session socket through the API origin selected by the client. */
export function resolveDictationWebSocketUrl(
	wsUrl: string,
	baseUrl?: string,
): string {
	const sessionUrl = new URL(wsUrl);
	if (!baseUrl) return sessionUrl.toString();
	const url = new URL(`${sessionUrl.pathname}${sessionUrl.search}`, baseUrl);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.toString();
}

/** Opens an existing dictation session and owns its WebSocket protocol. */
export async function connectDictationSession(
	options: ConnectDictationSessionOptions,
): Promise<DictationConnection> {
	const createSocket =
		options.webSocketFactory ??
		((url: string) => new WebSocket(url) as DictationWebSocketLike);
	const socket = createSocket(
		resolveDictationWebSocketUrl(options.session.wsUrl, options.baseUrl),
	);
	socket.binaryType = 'arraybuffer';

	let ready = false;
	let closed = false;
	let terminalError: Error | null = null;
	let resolveFinal: ((event: DictationFinalEvent) => void) | null = null;
	let rejectFinal: ((error: Error) => void) | null = null;

	const finalPromise = new Promise<DictationFinalEvent>((resolve, reject) => {
		resolveFinal = resolve;
		rejectFinal = reject;
	});
	// Errors can arrive while recording, before the caller invokes stop().
	void finalPromise.catch(() => undefined);

	const connection = await new Promise<DictationConnection>(
		(resolve, reject) => {
			const timeout = setTimeout(() => {
				const error = new Error('Timed out connecting to dictation server');
				terminalError = error;
				reject(error);
				socket.close(4000, 'Dictation connection timeout');
			}, options.timeoutMs ?? 5_000);

			const fail = (error: Error) => {
				terminalError = error;
				if (!ready) {
					clearTimeout(timeout);
					reject(error);
				}
				rejectFinal?.(error);
			};

			socket.onopen = () => {
				socket.send(
					JSON.stringify({
						type: 'start',
						model: options.session.model,
						language: options.language ?? 'en',
						format: DICTATION_AUDIO_FORMAT,
						partialResults: options.partialResults ?? false,
					}),
				);
			};

			socket.onmessage = (event) => {
				if (typeof event.data !== 'string') return;
				const payload = parseDictationServerEvent(event.data);
				if (!payload) return;
				options.onEvent?.(payload);

				if (payload.type === 'ready' && !ready) {
					ready = true;
					clearTimeout(timeout);
					resolve({
						sessionId: options.session.id,
						model: options.session.model,
						sendAudio(frame) {
							if (closed || socket.readyState !== 1) return;
							socket.send(frame);
						},
						async stop() {
							if (terminalError) throw terminalError;
							if (closed || socket.readyState !== 1) {
								throw new Error('Dictation connection is closed');
							}
							socket.send(JSON.stringify({ type: 'stop' }));
							return finalPromise;
						},
						cancel() {
							if (!closed && socket.readyState === 1) {
								socket.send(JSON.stringify({ type: 'cancel' }));
							}
							closed = true;
							socket.close(1000, 'Dictation cancelled');
						},
						close() {
							closed = true;
							socket.close(1000, 'Dictation cleanup');
						},
					});
					return;
				}

				if (payload.type === 'final') {
					resolveFinal?.(payload);
					return;
				}

				if (payload.type === 'error') {
					fail(new Error(payload.message));
				}
			};

			socket.onerror = () => {
				fail(new Error('Could not connect to dictation server'));
			};

			socket.onclose = () => {
				closed = true;
				if (!ready) {
					fail(new Error('Dictation connection closed before it was ready'));
					return;
				}
				if (!terminalError) {
					rejectFinal?.(
						new Error('Dictation connection closed before completion'),
					);
				}
			};
		},
	);

	return connection;
}

/** Streams model installation state from the daemon's SSE endpoint. */
export async function streamDictationModelInstall(
	options: StreamDictationModelInstallOptions,
): Promise<void> {
	const fetchImpl = options.fetch ?? fetch;
	const baseUrl = options.baseUrl.replace(/\/+$/, '');
	const url = `${baseUrl}/v1/dictation/models/${encodeURIComponent(options.model)}/install/events`;
	const response = await fetchImpl(url, {
		headers: {
			...options.headers,
			Accept: 'text/event-stream',
		},
		signal: options.signal,
	});

	if (!response.ok) {
		throw new Error(`Failed to stream model install: ${response.statusText}`);
	}
	if (!response.body) throw new Error('Model install stream has no body');

	const parser = createParser((event) => {
		if (event.type !== 'event') return;
		const model = parseDictationModelInstallEvent(event.data);
		if (model) options.onModel(model);
	});
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			parser.feed(decoder.decode(value, { stream: true }));
		}
		parser.feed(decoder.decode());
	} finally {
		reader.releaseLock();
	}
}

export function parseDictationServerEvent(
	raw: string,
): DictationServerEvent | null {
	try {
		const value = JSON.parse(raw) as Partial<DictationServerEvent>;
		if (!value || typeof value.type !== 'string') return null;
		if (
			value.type !== 'ready' &&
			value.type !== 'recording' &&
			value.type !== 'final' &&
			value.type !== 'error'
		) {
			return null;
		}
		return value as DictationServerEvent;
	} catch {
		return null;
	}
}

function parseDictationModelInstallEvent(
	raw: string,
): DictationModelState | null {
	try {
		const value = JSON.parse(raw) as {
			type?: string;
			model?: DictationModelState;
		};
		return value.type === 'model' && value.model ? value.model : null;
	} catch {
		return null;
	}
}
