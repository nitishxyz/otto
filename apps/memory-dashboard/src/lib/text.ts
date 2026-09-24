const SECRET_PATTERNS: RegExp[] = [
	/\b(?:sk|pk|rk|xoxb|xoxp|ghp|gho|ghu|ghs|ghr)[-_][A-Za-z0-9_-]{12,}\b/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
	/\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["']?[^\s"']{8,}/gi,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

/**
 * Masks common credential shapes before untrusted memory text hits the screen.
 * The store already screens writes; this is a last line of defence for display.
 */
export function redactSecrets(text: string): string {
	let out = text;
	for (const pattern of SECRET_PATTERNS) {
		out = out.replace(pattern, '[redacted]');
	}
	return out;
}

export function flatten(text: string | undefined): string {
	return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function excerpt(text: string | undefined, max = 80): string {
	const flat = flatten(text);
	if (flat.length <= max) return flat;
	return `${flat.slice(0, max - 1).trimEnd()}\u2026`;
}

const SENTENCE_END = /(?<!\b(?:e\.g|i\.e|etc|vs))[.!?](?=\s|$)/;

/**
 * Short human title for a memory: the first sentence (without its trailing
 * period), stripped of list/heading markers and trimmed to `max` characters.
 */
export function deriveTitle(text: string | undefined, max = 80): string {
	const flat = flatten(text).replace(/^(?:[-*\u2022>#]+|\d+[.)])\s+/, '');
	if (!flat) return 'Untitled memory';
	const end = SENTENCE_END.exec(flat);
	const sentence =
		end && end.index + 1 < flat.length ? flat.slice(0, end.index + 1) : flat;
	const trimmed = sentence.replace(/[.]$/, '');
	return excerpt(trimmed, max);
}

/** True when the full text says more than its derived title. */
export function hasMoreThanTitle(
	text: string | undefined,
	title: string,
): boolean {
	const flat = flatten(text).replace(/[.]$/, '');
	return flat.length > 0 && flat !== title;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(value: number, unit: string): string {
	return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

/** "just now", "14 minutes ago", "yesterday", "3 days ago", "Sep 3". */
export function timeAgo(iso: string, now = Date.now()): string {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	const diff = Math.max(0, now - t);
	if (diff < MINUTE) return 'just now';
	if (diff < HOUR) return `${plural(Math.floor(diff / MINUTE), 'minute')} ago`;
	if (diff < DAY) return `${plural(Math.floor(diff / HOUR), 'hour')} ago`;
	if (diff < 2 * DAY) return 'yesterday';
	if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
	return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Compact variant for dense rows: "now", "5m", "3h", "2d". */
export function shortAgo(iso: string, now = Date.now()): string {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	const diff = Math.max(0, now - t);
	if (diff < MINUTE) return 'now';
	if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
	if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
	return `${Math.floor(diff / DAY)}d`;
}

/** Full local date/time, for tooltips and timelines. */
export function fullDate(iso: string): string {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	return new Date(t).toLocaleString([], {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}
