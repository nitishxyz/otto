import { z } from 'zod/v3';

export const browserActions = [
	'open',
	'navigate',
	'back',
	'forward',
	'reload',
	'stop',
	'snapshot',
	'screenshot',
	'html',
	'find',
	'console',
	'network',
	'click',
	'hover',
	'type',
	'press',
	'scroll',
	'wait_for',
	'evaluate',
] as const;

export const browserKinds = ['browser', 'simulator'] as const;

const consoleLevels = ['all', 'log', 'info', 'warn', 'error', 'debug'] as const;

export const browserInputSchema = z.object({
	action: z.enum(browserActions),
	url: z
		.string()
		.optional()
		.describe('URL for open or navigate. Localhost may omit the scheme.'),
	title: z.string().optional().describe('Optional browser tab title for open.'),
	kind: z
		.enum(browserKinds)
		.optional()
		.describe('Use simulator for serve-sim previews; otherwise use browser.'),
	newTab: z
		.boolean()
		.optional()
		.describe('Create a new controllable browser tab when opening.'),
	tabId: z
		.string()
		.optional()
		.describe(
			'Target browser tab ID. Omit to use the main browser (or simulator) tab.',
		),
	selector: z
		.string()
		.optional()
		.describe('CSS selector or snapshot reference such as @e3.'),
	text: z
		.string()
		.optional()
		.describe('Text to enter for type, or text to await for wait_for.'),
	key: z
		.string()
		.optional()
		.describe('Keyboard key for action=press, such as Enter or Escape.'),
	x: z.number().optional().describe('Horizontal scroll delta in CSS pixels.'),
	y: z.number().optional().describe('Vertical scroll delta in CSS pixels.'),
	timeoutMs: z
		.number()
		.int()
		.min(100)
		.max(30_000)
		.optional()
		.describe('Timeout for wait_for. Defaults to 5000ms.'),
	script: z
		.string()
		.optional()
		.describe(
			'JavaScript source for action=evaluate. The last expression is returned and must be serializable.',
		),
	query: z
		.string()
		.optional()
		.describe(
			'Search string for find (matches rendered text and markup) or network (matches the URL).',
		),
	level: z
		.enum(consoleLevels)
		.optional()
		.describe('Console level filter for action=console. Defaults to all.'),
	limit: z
		.number()
		.int()
		.min(1)
		.max(500)
		.optional()
		.describe('Maximum entries returned by find, console, or network.'),
	maxLength: z
		.number()
		.int()
		.min(500)
		.max(200_000)
		.optional()
		.describe('Maximum characters returned by action=html. Defaults to 40000.'),
});

export type BrowserInput = z.infer<typeof browserInputSchema>;

const DEFAULT_WAIT_FOR_TIMEOUT_MS = 5_000;
const DEFAULT_HTML_MAX_LENGTH = 40_000;
const DEFAULT_ENTRY_LIMIT = 50;
const DEFAULT_FIND_LIMIT = 20;

export function normalizeBrowserUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error('Missing required string field: url');
	if (
		/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(
			trimmed,
		)
	) {
		return `http://${trimmed}`;
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

export function validateBrowserUrl(value: string): string {
	const normalized = normalizeBrowserUrl(value);
	const url = new URL(normalized);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(
			'Only http and https URLs can be opened in the built-in browser',
		);
	}
	return url.toString();
}

function requiredString(
	input: BrowserInput,
	field: 'selector' | 'text' | 'key' | 'script' | 'query',
): string {
	const value = input[field];
	if (typeof value !== 'string' || (field !== 'text' && !value.trim())) {
		throw new Error(`Missing required string field: ${field}`);
	}
	return value;
}

export function defaultTabId(kind: (typeof browserKinds)[number]): string {
	return `browser:${kind}`;
}

export function waitForTimeoutMs(input: BrowserInput): number {
	return input.timeoutMs ?? DEFAULT_WAIT_FOR_TIMEOUT_MS;
}

/** Builds the viewer-side arguments for a non-open browser action. */
export function browserControlArgs(
	input: BrowserInput,
): Record<string, unknown> {
	switch (input.action) {
		case 'navigate':
			return { url: validateBrowserUrl(input.url ?? '') };
		case 'click':
		case 'hover':
			return { selector: requiredString(input, 'selector') };
		case 'type':
			return {
				selector: requiredString(input, 'selector'),
				text: requiredString(input, 'text'),
			};
		case 'press':
			return {
				selector: input.selector,
				key: requiredString(input, 'key'),
			};
		case 'scroll':
			return {
				selector: input.selector,
				x: input.x ?? 0,
				y: input.y ?? 600,
			};
		case 'wait_for': {
			if (!input.selector?.trim() && !input.text?.trim()) {
				throw new Error('wait_for requires either selector or text');
			}
			return {
				selector: input.selector,
				text: input.text,
				timeoutMs: waitForTimeoutMs(input),
			};
		}
		case 'evaluate':
			return { script: requiredString(input, 'script') };
		case 'html':
			return {
				selector: input.selector,
				maxLength: input.maxLength ?? DEFAULT_HTML_MAX_LENGTH,
			};
		case 'find':
			return {
				query: requiredString(input, 'query'),
				limit: input.limit ?? DEFAULT_FIND_LIMIT,
			};
		case 'console':
			return {
				level: input.level ?? 'all',
				limit: input.limit ?? DEFAULT_ENTRY_LIMIT,
			};
		case 'network':
			return {
				query: input.query,
				limit: input.limit ?? DEFAULT_ENTRY_LIMIT,
			};
		case 'screenshot':
			return { selector: input.selector };
		case 'back':
		case 'forward':
		case 'reload':
		case 'stop':
		case 'snapshot':
			return {};
		case 'open':
			throw new Error('Open is handled directly');
	}
}
