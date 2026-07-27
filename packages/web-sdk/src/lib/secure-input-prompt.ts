const EMPTY_RESPONSE_PROMPT_PATTERNS = [
	/(?:^|\n)(?:press|hit)\s+(?:enter|return)(?:\s+[^\n]*)?\s*$/i,
	/(?:^|\n)[^\n]{1,200}(?:\[|\()(?:default(?:\s*[:=]\s*[^\])]+)?|optional)(?:\]|\))\s*:?\s*$/i,
];

/** Preserves compatibility when an older event omits the allowEmpty field. */
export function allowsEmptySecureInput(
	prompt: string,
	explicit?: boolean,
): boolean {
	return (
		explicit === true ||
		EMPTY_RESPONSE_PROMPT_PATTERNS.some((pattern) =>
			pattern.test(prompt.trim()),
		)
	);
}
