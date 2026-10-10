export const THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';

type ThinkingConfig = {
	type?: string;
	block_binding?: Record<string, unknown>;
	[key: string]: unknown;
};

/**
 * Opts adaptive/enabled thinking requests into `drop_block` so replayed
 * thinking blocks whose conversation prefix changed (e.g. lazily loaded
 * tools altering the `tools` list) are dropped instead of failing with a 400.
 * Returns true when the body was changed and the beta header is required.
 */
export function addThinkingBlockBinding(parsed: {
	thinking?: ThinkingConfig;
	[key: string]: unknown;
}): boolean {
	const thinking = parsed.thinking;
	if (!thinking || typeof thinking !== 'object') return false;
	if (thinking.type !== 'adaptive' && thinking.type !== 'enabled') return false;
	if (thinking.block_binding) return true;
	parsed.thinking = {
		...thinking,
		block_binding: { prefix_mismatch_behavior: 'drop_block' },
	};
	return true;
}

/** Appends a beta flag to a comma-separated `anthropic-beta` header value. */
export function mergeAnthropicBeta(
	existing: string | null | undefined,
	beta: string,
): string {
	const values = (existing ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	if (!values.includes(beta)) values.push(beta);
	return values.join(',');
}
