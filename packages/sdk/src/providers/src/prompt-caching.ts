/**
 * Adds a stable cache-affinity key to JSON requests for APIs that support the
 * OpenAI `prompt_cache_key` extension. Existing caller-provided keys win.
 */
export function createPromptCacheKeyFetch(
	baseFetch: typeof fetch = fetch,
	promptCacheKey?: string,
): typeof fetch {
	if (!promptCacheKey) return baseFetch;

	const wrappedFetch = async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	): Promise<Response> => {
		if (typeof init?.body !== 'string') return baseFetch(input, init);

		try {
			const parsed = JSON.parse(init.body) as unknown;
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return baseFetch(input, init);
			}

			const body = parsed as Record<string, unknown>;
			if (typeof body.prompt_cache_key === 'string') {
				return baseFetch(input, init);
			}
			body.prompt_cache_key = promptCacheKey;
			return baseFetch(input, { ...init, body: JSON.stringify(body) });
		} catch {
			return baseFetch(input, init);
		}
	};

	return wrappedFetch as typeof fetch;
}
