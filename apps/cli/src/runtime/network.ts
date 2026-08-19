import { InvalidArgumentError } from 'commander';

export interface ParseCliPortOptions {
	allowZero: boolean;
	name?: string;
}

/** Parses a complete decimal TCP port using the caller's explicit zero policy. */
export function parseCliPort(
	value: string,
	options: ParseCliPortOptions,
): number {
	const minimum = options.allowZero ? 0 : 1;
	if (!/^\d+$/.test(value)) {
		throw new InvalidArgumentError(
			`Invalid ${options.name ?? 'port'}: ${value}`,
		);
	}
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < minimum || port > 65_535) {
		throw new InvalidArgumentError(
			`Invalid ${options.name ?? 'port'}: ${value}`,
		);
	}
	return port;
}

/** Parses an optional port from an environment variable. */
export function parseOptionalCliPort(
	value: string | undefined,
	options: ParseCliPortOptions,
): number | undefined {
	return value === undefined ? undefined : parseCliPort(value, options);
}

/** Validates a port that has already been converted to a number. */
export function validateCliPort(
	port: number,
	options: ParseCliPortOptions,
): number {
	return parseCliPort(String(port), options);
}
