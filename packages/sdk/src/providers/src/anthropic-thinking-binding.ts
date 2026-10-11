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

/** Retries only conversation-bound signature errors, without replayed thinking. */
export async function retryWithoutBoundThinking(
	response: Response,
	body: unknown,
	retry: (body: string) => Promise<Response>,
): Promise<Response> {
	if (response.status !== 400 || typeof body !== 'string') return response;
	let retryBody: string;
	try {
		const payload = (await response.clone().json()) as {
			error?: { type?: string; message?: string };
		};
		const error = payload.error;
		if (
			error?.type !== 'invalid_request_error' ||
			typeof error.message !== 'string' ||
			!error.message.includes('Invalid `signature` in `thinking` block') ||
			!error.message.includes('bound to a different conversation')
		) {
			return response;
		}

		const parsed = JSON.parse(body) as {
			messages?: Array<{ role: string; content: unknown }>;
		};
		if (!Array.isArray(parsed.messages)) return response;
		let removed = false;
		parsed.messages = parsed.messages.flatMap((message) => {
			if (message.role !== 'assistant' || !Array.isArray(message.content)) {
				return [message];
			}
			const content = message.content.filter((block: unknown) => {
				if (!block || typeof block !== 'object' || !('type' in block)) {
					return true;
				}
				if (block.type !== 'thinking' && block.type !== 'redacted_thinking') {
					return true;
				}
				removed = true;
				return false;
			});
			if (content.length === message.content.length) return [message];
			return content.length ? [{ ...message, content }] : [];
		});
		if (!removed) return response;
		retryBody = JSON.stringify(parsed);
	} catch {
		return response;
	}
	return retry(retryBody);
}
