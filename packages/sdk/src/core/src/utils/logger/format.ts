export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ANSI_RESET = '\x1b[0m';
const ANSI_DIM = '\x1b[2m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_BLUE = '\x1b[34m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';

export function safeHasMeta(
	meta?: Record<string, unknown>,
): meta is Record<string, unknown> {
	return Boolean(meta && Object.keys(meta).length);
}

export function serializeLogMeta(meta?: Record<string, unknown>): string {
	if (!safeHasMeta(meta)) return '';
	try {
		const sanitized = { ...meta };
		delete sanitized.debugDetail;
		return Object.keys(sanitized).length ? ` ${JSON.stringify(sanitized)}` : '';
	} catch {
		return ' [unserializable-meta]';
	}
}

export function colorizeLine(line: string, level: LogLevel): string {
	const levelColor =
		level === 'debug'
			? ANSI_CYAN
			: level === 'info'
				? ANSI_BLUE
				: level === 'warn'
					? ANSI_YELLOW
					: ANSI_RED;
	const scopeMatch = line.match(
		/\[(debug|info|warn|error|timing)\]\s+\[([^\]]+)\]/i,
	);
	if (!scopeMatch) {
		return `${levelColor}${line}${ANSI_RESET}`;
	}
	const rest = line.slice(24);
	return `${ANSI_DIM}${line.slice(0, 24)}${ANSI_RESET}${rest
		.replace(scopeMatch[1], `${levelColor}${scopeMatch[1]}${ANSI_RESET}`)
		.replace(
			`[${scopeMatch[2]}]`,
			`${ANSI_GREEN}[${scopeMatch[2]}]${ANSI_RESET}`,
		)}`;
}
