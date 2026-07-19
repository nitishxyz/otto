const CONTEXT_OVERFLOW_PATTERNS = [
	/\bcontext[_ -]length[_ -]exceeded\b/i,
	/\bcontext[_ -]window[_ -]exceeded\b/i,
	/\bmaximum context length\b/i,
	/\bcontext (?:length|window).{0,40}\b(?:exceed(?:ed|s)?|limit|full)\b/i,
	/\b(?:exceed(?:ed|s)?|over).{0,40}\bcontext (?:length|window|limit)\b/i,
	/\bprompt (?:is )?too long\b/i,
	/\binput (?:is )?too long\b/i,
	/\btoo many (?:input )?tokens\b/i,
	/\bprompt token count.{0,40}\b(?:exceed(?:ed|s)?|limit|maximum)\b/i,
];

const ERROR_TEXT_FIELDS = [
	'message',
	'code',
	'type',
	'apiErrorType',
	'responseBody',
] as const;

const NESTED_ERROR_FIELDS = ['error', 'cause', 'data', 'response'] as const;

function collectErrorText(
	value: unknown,
	parts: string[],
	seen: Set<object>,
	depth = 0,
): void {
	if (depth > 5 || value == null) return;
	if (typeof value === 'string') {
		parts.push(value);
		return;
	}
	if (typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);

	const record = value as Record<string, unknown>;
	for (const field of ERROR_TEXT_FIELDS) {
		if (typeof record[field] === 'string') parts.push(record[field]);
	}
	for (const field of NESTED_ERROR_FIELDS) {
		collectErrorText(record[field], parts, seen, depth + 1);
	}
}

/** Returns true only when an error explicitly reports context/token overflow. */
export function isContextOverflowError(error: unknown): boolean {
	const parts: string[] = [];
	collectErrorText(error, parts, new Set());
	return CONTEXT_OVERFLOW_PATTERNS.some((pattern) =>
		parts.some((part) => pattern.test(part)),
	);
}
