function abortReasonError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	const error = new Error(
		typeof signal.reason === 'string' ? signal.reason : 'Operation aborted',
	);
	error.name = 'AbortError';
	return error;
}

/** Throws the signal's abort reason when the run was cancelled. */
export function throwIfRunAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw abortReasonError(signal);
}

/**
 * Settles with `promise`, or rejects as soon as `signal` aborts. The
 * underlying work is not cancelled; callers pass the signal down where the
 * callee supports it.
 */
export function raceAbort<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined,
): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) {
		promise.catch(() => undefined);
		return Promise.reject(abortReasonError(signal));
	}
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(abortReasonError(signal));
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener('abort', onAbort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener('abort', onAbort);
				reject(error);
			},
		);
	});
}

/** Like `raceAbort`, but resolves to `fallback` instead of rejecting. */
export async function withAbortFallback<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined,
	fallback: T,
): Promise<T> {
	try {
		return await raceAbort(promise, signal);
	} catch (error) {
		if (signal?.aborted) return fallback;
		throw error;
	}
}
