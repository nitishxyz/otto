import { boundToolEventValue } from './tool-payload.ts';

export const SSE_QUEUE_HIGH_WATER_MARK_BYTES = 1024 * 1024;
export const SSE_MAX_EVENT_BYTES = 256 * 1024;

const encoder = new TextEncoder();
const SSE_HEADERS = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache, no-transform',
	Connection: 'keep-alive',
	'X-Accel-Buffering': 'no',
} as const;
let activeProjectStreams = 0;
let droppedProjectStreams = 0;
let projectStreamBytesQueued = 0;
let oversizedEvents = 0;

function safeStringify(value: unknown): string {
	return JSON.stringify(value, (_key, item) =>
		typeof item === 'bigint' ? Number(item) : item,
	);
}

export function encodeSSEEvent(
	eventType: string,
	data: unknown,
	eventId?: string,
): Uint8Array {
	let serialized: string;
	try {
		serialized = safeStringify(data);
	} catch {
		serialized = '{}';
	}

	if (Buffer.byteLength(serialized, 'utf8') > SSE_MAX_EVENT_BYTES) {
		oversizedEvents += 1;
		const bounded = boundToolEventValue(data);
		const value =
			bounded.value &&
			typeof bounded.value === 'object' &&
			!Array.isArray(bounded.value)
				? {
						...(bounded.value as Record<string, unknown>),
						streamPayloadTruncated: true,
						streamPayloadOriginalBytes: bounded.originalBytes,
					}
				: {
						value: bounded.value,
						streamPayloadTruncated: true,
						streamPayloadOriginalBytes: bounded.originalBytes,
					};
		try {
			serialized = safeStringify(value);
		} catch {
			serialized = '{"streamPayloadTruncated":true}';
		}
		if (Buffer.byteLength(serialized, 'utf8') > SSE_MAX_EVENT_BYTES) {
			serialized = safeStringify({
				streamPayloadTruncated: true,
				streamPayloadOriginalBytes: bounded.originalBytes,
				streamPayloadOmitted: true,
			});
		}
	}

	const idLine = eventId ? `id: ${eventId}\n` : '';
	return encoder.encode(
		`${idLine}event: ${eventType}\ndata: ${serialized}\n\n`,
	);
}

export function encodeSSEComment(comment: string): Uint8Array {
	return encoder.encode(`: ${comment}\n\n`);
}

export function createSSEEncodingCache<T extends object>(
	encode: (value: T) => Uint8Array,
): (value: T) => Uint8Array {
	const chunks = new WeakMap<T, Uint8Array>();
	return (value) => {
		const cached = chunks.get(value);
		if (cached) return cached;
		const chunk = encode(value);
		chunks.set(value, chunk);
		return chunk;
	};
}

export interface SSEStreamControls {
	send(chunk: Uint8Array): boolean;
	onCleanup(cleanup: () => void): void;
}

export interface SSEResponseOptions {
	signal?: AbortSignal;
	initialChunk?: Uint8Array;
	heartbeat?: {
		intervalMs: number;
		createChunk: () => Uint8Array;
	};
	start?: (controls: SSEStreamControls) => void;
	onEnqueue?: (chunk: Uint8Array, desiredSize: number | null) => void;
	onBackpressure?: (chunk: Uint8Array) => void;
	strategy?: QueuingStrategy<Uint8Array>;
}

/** Owns the transport lifecycle while callers retain event filtering and replay. */
export function createSSEResponse(options: SSEResponseOptions): Response {
	let cleanup = () => {};
	const stream = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				let closed = false;
				let heartbeat: ReturnType<typeof setInterval> | undefined;
				const cleanups: Array<() => void> = [];

				cleanup = () => {
					if (closed) return;
					closed = true;
					if (heartbeat !== undefined) clearInterval(heartbeat);
					options.signal?.removeEventListener('abort', cleanup);
					for (const callback of cleanups.splice(0)) {
						try {
							callback();
						} catch {}
					}
					try {
						controller.close();
					} catch {}
				};

				const controls: SSEStreamControls = {
					send(chunk) {
						if (closed) return false;
						try {
							controller.enqueue(chunk);
							options.onEnqueue?.(chunk, controller.desiredSize);
							if ((controller.desiredSize ?? 0) < 0) {
								try {
									options.onBackpressure?.(chunk);
								} finally {
									cleanup();
								}
								return false;
							}
							return true;
						} catch {
							cleanup();
							return false;
						}
					},
					onCleanup(callback) {
						if (closed) callback();
						else cleanups.push(callback);
					},
				};

				options.signal?.addEventListener('abort', cleanup, { once: true });
				if (options.signal?.aborted) {
					cleanup();
					return;
				}
				try {
					options.start?.(controls);
				} catch {
					cleanup();
					return;
				}
				if (options.initialChunk && !controls.send(options.initialChunk))
					return;
				if (options.heartbeat && !closed) {
					const heartbeatOptions = options.heartbeat;
					heartbeat = setInterval(() => {
						try {
							controls.send(heartbeatOptions.createChunk());
						} catch {
							cleanup();
						}
					}, heartbeatOptions.intervalMs);
				}
			},
			cancel() {
				cleanup();
			},
		},
		options.strategy ?? createSSEByteStrategy(),
	);

	return new Response(stream, { headers: SSE_HEADERS });
}

export interface ProjectSSEStreamMetricsHandle {
	updateQueued(bytes: number): void;
	markDropped(): void;
	close(): void;
}

export function trackProjectSSEStream(): ProjectSSEStreamMetricsHandle {
	activeProjectStreams += 1;
	let queued = 0;
	let closed = false;
	let dropped = false;
	return {
		updateQueued(bytes) {
			if (closed) return;
			const next = Math.max(0, Math.round(bytes));
			projectStreamBytesQueued += next - queued;
			queued = next;
		},
		markDropped() {
			if (dropped) return;
			dropped = true;
			droppedProjectStreams += 1;
		},
		close() {
			if (closed) return;
			closed = true;
			activeProjectStreams = Math.max(0, activeProjectStreams - 1);
			projectStreamBytesQueued = Math.max(0, projectStreamBytesQueued - queued);
		},
	};
}

export function getSSEStats() {
	return {
		activeProjectStreams,
		droppedProjectStreams,
		bytesQueued: projectStreamBytesQueued,
		oversizedEvents,
	};
}

export function createSSEByteStrategy(): QueuingStrategy<Uint8Array> {
	return new ByteLengthQueuingStrategy({
		highWaterMark: SSE_QUEUE_HIGH_WATER_MARK_BYTES,
	});
}
