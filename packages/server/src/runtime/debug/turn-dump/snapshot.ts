const CREDENTIAL =
	/(?:authorization|cookie|api[-_]?key|token|password|secret|private[-_]?key|credentials)$/i;

/** Copy diagnostic input without retaining secrets, caller references, or unbounded payloads. */
export function snapshot<T>(input: T): T {
	let remaining = 250_000;
	const seen = new WeakSet<object>();
	function copy(value: unknown, depth: number): unknown {
		if (depth > 12 || remaining <= 0) return '[TRUNCATED]';
		remaining--;
		if (typeof value === 'string') {
			const redacted = value.replace(
				/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
				'$1 [REDACTED]',
			);
			const length = Math.min(redacted.length, remaining, 50_000);
			remaining -= length;
			return (
				redacted.slice(0, length) +
				(length < redacted.length ? '...[TRUNCATED]' : '')
			);
		}
		if (!value || typeof value !== 'object')
			return typeof value === 'bigint' ? String(value) : value;
		if (seen.has(value)) return '[CIRCULAR]';
		seen.add(value);
		if (Array.isArray(value))
			return value.slice(0, 200).map((item) => copy(item, depth + 1));
		return Object.fromEntries(
			Object.entries(value)
				.slice(0, 200)
				.map(([key, item]) => [
					key.slice(0, 200),
					CREDENTIAL.test(key) ? '[REDACTED]' : copy(item, depth + 1),
				]),
		);
	}
	return copy(input, 0) as T;
}
