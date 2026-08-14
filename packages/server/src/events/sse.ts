import { boundToolEventValue } from './tool-payload.ts';

export const SSE_QUEUE_HIGH_WATER_MARK_BYTES = 1024 * 1024;
export const SSE_MAX_EVENT_BYTES = 256 * 1024;

const encoder = new TextEncoder();
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
