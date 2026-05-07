import { isDebugEnabled, isTraceEnabled, getDebugScopes } from './debug.ts';
import { colorizeLine, safeHasMeta, type LogLevel } from './logger/format.ts';
import { writeLogLine } from './logger/sinks.ts';

function shouldWriteDebugLog(message: string): boolean {
	if (!isDebugEnabled()) return false;
	const scopes = getDebugScopes();
	if (!scopes.length) return true;
	const match = message.match(/^\[([^\]]+)\]/);
	if (!match?.[1]) return true;
	return scopes.includes(match[1]);
}

function printLine(
	level: LogLevel,
	line: string,
	meta?: Record<string, unknown>,
) {
	const colored = colorizeLine(line, level);
	if (safeHasMeta(meta)) {
		if (level === 'warn') console.warn(colored, meta);
		else if (level === 'error') console.error(colored, meta);
		else console.log(colored, meta);
		return;
	}
	if (level === 'warn') console.warn(colored);
	else if (level === 'error') console.error(colored);
	else console.log(colored);
}

export function debug(message: string, meta?: Record<string, unknown>): void {
	if (!shouldWriteDebugLog(message)) return;
	try {
		const line = writeLogLine(`[debug] ${message}`, meta);
		printLine('debug', line, meta);
	} catch {
		// ignore logging errors
	}
}

export function info(message: string, meta?: Record<string, unknown>): void {
	if (!shouldWriteDebugLog(message) && !isTraceEnabled()) return;
	try {
		const line = writeLogLine(`[info] ${message}`, meta);
		printLine('info', line, meta);
	} catch {
		// ignore logging errors
	}
}

export function warn(message: string, meta?: Record<string, unknown>): void {
	try {
		const line = writeLogLine(`[warn] ${message}`, meta);
		printLine('warn', line, meta);
	} catch {
		// ignore logging errors
	}
}

export function error(
	message: string,
	err?: unknown,
	meta?: Record<string, unknown>,
): void {
	if (!isDebugEnabled()) return;

	try {
		const logMeta: Record<string, unknown> = meta ? { ...meta } : {};

		if (err) {
			if (err instanceof Error) {
				logMeta.error = {
					name: err.name,
					message: err.message,
				};
				if (isTraceEnabled() && err.stack) {
					(logMeta.error as { stack?: string }).stack = err.stack;
				}
			} else if (typeof err === 'string') {
				logMeta.error = err;
			} else if (typeof err === 'object') {
				const errObj = err as Record<string, unknown>;
				const details: Record<string, unknown> = {};
				if (typeof errObj.name === 'string') details.name = errObj.name;
				if (typeof errObj.message === 'string')
					details.message = errObj.message;
				if (typeof errObj.code === 'string') details.code = errObj.code;
				if (typeof errObj.status === 'number') details.status = errObj.status;
				if (typeof errObj.statusCode === 'number')
					details.statusCode = errObj.statusCode;
				if (
					isTraceEnabled() &&
					typeof errObj.stack === 'string' &&
					!details.stack
				) {
					details.stack = errObj.stack;
				}
				logMeta.error = Object.keys(details).length ? details : errObj;
			} else {
				logMeta.error = String(err);
			}
		}

		if (safeHasMeta(logMeta)) {
			const line = writeLogLine(`[error] ${message}`, logMeta);
			printLine('error', line, logMeta);
		} else {
			const line = writeLogLine(`[error] ${message}`);
			printLine('error', line);
		}
	} catch (logErr) {
		try {
			console.error(`[error] ${message} (logging failed)`, logErr);
		} catch {
			// ignore
		}
	}
}

export const logger = {
	debug,
	info,
	warn,
	error,
};

function nowMs(): number {
	const perf = (globalThis as { performance?: { now?: () => number } })
		.performance;
	if (perf && typeof perf.now === 'function') return perf.now();
	return Date.now();
}

type Timer = {
	end(meta?: Record<string, unknown>): void;
};

export function time(label: string): Timer {
	if (!isDebugEnabled()) {
		return { end() {} };
	}

	const start = nowMs();
	let finished = false;

	return {
		end(meta?: Record<string, unknown>) {
			if (finished) return;
			finished = true;
			const duration = nowMs() - start;
			try {
				const base = writeLogLine(
					`[timing] ${label} ${duration.toFixed(1)}ms`,
					meta,
				);
				printLine('info', base, meta);
			} catch {
				// ignore timing log errors
			}
		},
	};
}
