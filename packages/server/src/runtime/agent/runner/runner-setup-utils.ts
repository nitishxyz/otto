export type TimedResult<T> = {
	value: T;
	durationMs: number;
};

export function nowMs(): number {
	const perf = globalThis.performance;
	if (perf && typeof perf.now === 'function') return perf.now();
	return Date.now();
}

export async function timePromise<T>(
	promise: Promise<T>,
): Promise<TimedResult<T>> {
	const startedAt = nowMs();
	const value = await promise;
	return {
		value,
		durationMs: nowMs() - startedAt,
	};
}
