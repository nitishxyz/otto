/**
 * Declares a tool input field that carries a secret.
 *
 * `path` is a dot path into the input object. `*` matches every key of an
 * object (or every item of an array), e.g. `env.*` or `headers.*`.
 */
export type ToolSensitiveInput = {
	path: string;
	/**
	 * When set and the field is missing, the server asks the user for the
	 * value through secure input instead of letting the model supply it.
	 */
	secureInput?: {
		prompt: string;
		/** Only request secure input when this returns true for the input. */
		when?: (input: Record<string, unknown>) => boolean;
	};
};

export const REDACTED_INPUT_VALUE = '[redacted]';

function redactAtPath(value: unknown, segments: string[]): unknown {
	if (segments.length === 0) {
		return value === undefined || value === null || value === ''
			? value
			: REDACTED_INPUT_VALUE;
	}
	if (!value || typeof value !== 'object') return value;
	const [head, ...rest] = segments;
	if (Array.isArray(value)) {
		if (head !== '*') return value;
		return value.map((item) => redactAtPath(item, rest));
	}
	const record = value as Record<string, unknown>;
	if (head === '*') {
		const next: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(record)) {
			next[key] = redactAtPath(item, rest);
		}
		return next;
	}
	if (!head || !(head in record)) return value;
	return { ...record, [head]: redactAtPath(record[head], rest) };
}

/** Returns a copy of `input` with every declared sensitive field redacted. */
export function redactSensitiveInput(
	input: unknown,
	sensitive: readonly ToolSensitiveInput[] | undefined,
): unknown {
	if (!sensitive?.length || !input || typeof input !== 'object') return input;
	let next: unknown = input;
	for (const entry of sensitive) {
		next = redactAtPath(next, entry.path.split('.').filter(Boolean));
	}
	return next;
}

/** True when any declared sensitive field holds a non-empty value. */
export function hasSensitiveInputValue(
	input: unknown,
	sensitive: readonly ToolSensitiveInput[] | undefined,
): boolean {
	if (!sensitive?.length) return false;
	return (
		JSON.stringify(redactSensitiveInput(input, sensitive)) !==
		JSON.stringify(input)
	);
}
