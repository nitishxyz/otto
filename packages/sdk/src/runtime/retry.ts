export type RetryContext = {
	attempt: number;
	maxRetries: number;
};

export type RetryOptions = {
	maxRetries: number;
	delayMs?: number | ((context: RetryContext) => number);
	signal?: AbortSignal | null;
	shouldRetry?: (error: unknown, context: RetryContext) => boolean;
	onRetry?: (
		error: unknown,
		context: RetryContext & { delayMs: number },
	) => void;
};

/** Parse an integer setting, returning the fallback when absent or below the minimum. */
export function parseIntegerSetting(
	raw: string | undefined,
	fallback: number,
	options: { min: number },
): number {
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= options.min ? parsed : fallback;
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

/** Wait for a bounded duration and reject immediately when the signal aborts. */
export function abortableDelay(
	ms: number,
	signal?: AbortSignal | null,
): Promise<void> {
	if (signal?.aborted) return Promise.reject(abortReason(signal));
	if (ms <= 0) return Promise.resolve();

	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortReason(signal as AbortSignal));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/** Run an operation with a bounded retry count and optional abort-aware backoff. */
export async function retry<T>(
	operation: (context: RetryContext) => Promise<T>,
	options: RetryOptions,
): Promise<T> {
	const maxRetries = Math.max(0, options.maxRetries);

	for (let attempt = 0; ; attempt++) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		const context = { attempt, maxRetries };
		try {
			return await operation(context);
		} catch (error) {
			if (options.signal?.aborted) throw abortReason(options.signal);
			if (
				attempt >= maxRetries ||
				(options.shouldRetry && !options.shouldRetry(error, context))
			) {
				throw error;
			}

			const delayMs = Math.max(
				0,
				typeof options.delayMs === 'function'
					? options.delayMs(context)
					: (options.delayMs ?? 0),
			);
			options.onRetry?.(error, { ...context, delayMs });
			await abortableDelay(delayMs, options.signal);
		}
	}
}
