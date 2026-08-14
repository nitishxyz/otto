const MAX_EVENT_VALUE_CHARS = 64_000;
const MAX_EVENT_STRING_CHARS = 24_000;
const STRING_HEAD_CHARS = 8_000;
const STRING_TAIL_CHARS = 16_000;
const MAX_EVENT_DEPTH = 8;
const MAX_EVENT_ENTRIES = 100;

const TRUNCATION_MARKER = '\n… truncated for live stream …\n';

export interface BoundedToolEventValue {
	value: unknown;
	truncated: boolean;
	originalBytes: number;
}

interface BoundState {
	remainingChars: number;
	truncated: boolean;
	originalBytes: number;
	seen: WeakSet<object>;
}

function utf8Bytes(value: string): number {
	return Buffer.byteLength(value, 'utf8');
}

function boundedString(value: string, state: BoundState): string {
	state.originalBytes += utf8Bytes(value);
	const allowed = Math.min(MAX_EVENT_STRING_CHARS, state.remainingChars);
	if (value.length <= allowed) {
		state.remainingChars -= value.length;
		return value;
	}

	state.truncated = true;
	if (allowed <= TRUNCATION_MARKER.length) {
		state.remainingChars = 0;
		return '…';
	}

	const contentChars = allowed - TRUNCATION_MARKER.length;
	const headChars = Math.min(STRING_HEAD_CHARS, Math.floor(contentChars / 3));
	const tailChars = Math.min(STRING_TAIL_CHARS, contentChars - headChars);
	state.remainingChars -= headChars + tailChars + TRUNCATION_MARKER.length;
	return `${value.slice(0, headChars)}${TRUNCATION_MARKER}${value.slice(
		-tailChars,
	)}`;
}

function boundValue(value: unknown, state: BoundState, depth: number): unknown {
	if (typeof value === 'string') return boundedString(value, state);
	if (
		value === null ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		state.originalBytes += utf8Bytes(String(value));
		return value;
	}
	if (typeof value === 'bigint') {
		const numberValue = Number(value);
		state.originalBytes += utf8Bytes(String(numberValue));
		return numberValue;
	}
	if (value === undefined) return undefined;
	if (typeof value === 'function' || typeof value === 'symbol') {
		state.truncated = true;
		return String(value);
	}
	if (depth >= MAX_EVENT_DEPTH) {
		state.truncated = true;
		return '[Maximum depth reached]';
	}
	if (ArrayBuffer.isView(value)) {
		state.originalBytes += value.byteLength;
		state.truncated = true;
		return { byteLength: value.byteLength, dataOmitted: true };
	}
	if (value instanceof ArrayBuffer) {
		state.originalBytes += value.byteLength;
		state.truncated = true;
		return { byteLength: value.byteLength, dataOmitted: true };
	}
	if (value instanceof Date) return boundedString(value.toISOString(), state);
	if (typeof value !== 'object') return value;
	if (state.seen.has(value)) {
		state.truncated = true;
		return '[Circular]';
	}
	state.seen.add(value);

	if (Array.isArray(value)) {
		const result: unknown[] = [];
		const limit = Math.min(value.length, MAX_EVENT_ENTRIES);
		for (let index = 0; index < limit && state.remainingChars > 0; index++) {
			result.push(boundValue(value[index], state, depth + 1));
		}
		if (limit < value.length || result.length < limit) state.truncated = true;
		return result;
	}

	const result: Record<string, unknown> = {};
	let entries: Array<[string, unknown]>;
	try {
		entries = Object.entries(value as Record<string, unknown>);
	} catch {
		state.truncated = true;
		return '[Unserializable object]';
	}
	const limit = Math.min(entries.length, MAX_EVENT_ENTRIES);
	for (let index = 0; index < limit && state.remainingChars > 0; index++) {
		const [key, entryValue] = entries[index];
		state.originalBytes += utf8Bytes(key);
		result[key] = boundValue(entryValue, state, depth + 1);
	}
	if (limit < entries.length || Object.keys(result).length < limit) {
		state.truncated = true;
	}
	return result;
}

/** Bounds live tool payloads while retaining useful head/tail previews. */
export function boundToolEventValue(value: unknown): BoundedToolEventValue {
	const state: BoundState = {
		remainingChars: MAX_EVENT_VALUE_CHARS,
		truncated: false,
		originalBytes: 0,
		seen: new WeakSet(),
	};
	const bounded = boundValue(value, state, 0);
	return {
		value: bounded,
		truncated: state.truncated,
		originalBytes: state.originalBytes,
	};
}
