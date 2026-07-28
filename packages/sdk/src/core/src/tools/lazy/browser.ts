import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { requestBrowserControl } from '../../../../browser-control.ts';
import { createToolError } from '../error.ts';

const browserActions = [
	'open',
	'navigate',
	'back',
	'forward',
	'reload',
	'stop',
	'snapshot',
	'click',
	'type',
	'press',
	'scroll',
	'wait_for',
	'evaluate',
] as const;
const browserKinds = ['browser', 'simulator'] as const;

const browserInputSchema = z.object({
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
	text: z.string().optional().describe('Text to enter for action=type.'),
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
			'JavaScript source for action=evaluate. Keep results serializable.',
		),
});

type BrowserInput = z.infer<typeof browserInputSchema>;

function normalizeBrowserUrl(value: string): string {
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

function validateBrowserUrl(value: string): string {
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
	field: 'selector' | 'text' | 'key' | 'script',
): string {
	const value = input[field];
	if (typeof value !== 'string' || (field !== 'text' && !value.trim())) {
		throw new Error(`Missing required string field: ${field}`);
	}
	return value;
}

function defaultTabId(kind: (typeof browserKinds)[number]): string {
	return `browser:${kind}`;
}

function controlArgs(input: BrowserInput): Record<string, unknown> {
	switch (input.action) {
		case 'navigate':
			return { url: validateBrowserUrl(input.url ?? '') };
		case 'click':
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
		case 'wait_for':
			return {
				selector: requiredString(input, 'selector'),
				timeoutMs: input.timeoutMs ?? 5_000,
			};
		case 'evaluate':
			return { script: requiredString(input, 'script') };
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

export function buildBrowserTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	return {
		name: 'browser',
		tool: tool({
			description:
				'Open and control a page in Otto built-in browser. Use open first, then snapshot to inspect visible text and interactive elements. Snapshot returns stable element references such as @e1 that can be passed as selectors to click, type, press, scroll, or wait_for. navigate/back/forward/reload/stop control navigation. evaluate runs JavaScript for deeper page inspection. Desktop uses a native top-level webview; web clients can only automate same-origin iframe pages because browser security blocks cross-origin DOM access.',
			inputSchema: browserInputSchema,
			execute: async (input) => {
				try {
					const kind = input.kind ?? 'browser';
					if (input.action === 'open') {
						const url = validateBrowserUrl(input.url ?? '');
						const title =
							input.title ?? (kind === 'simulator' ? 'Simulator' : 'Browser');
						const tabId =
							input.tabId ??
							(input.newTab
								? `browser:agent:${crypto.randomUUID()}`
								: defaultTabId(kind));
						return {
							ok: true,
							action: 'open',
							url,
							title,
							kind,
							tabId,
							newTab: input.newTab ?? false,
							message: `Opened ${url} in Otto built-in browser preview`,
						};
					}

					const tabId = input.tabId ?? defaultTabId(kind);
					const result = await requestBrowserControl(
						{
							projectRoot,
							tabId,
							action: input.action,
							args: controlArgs(input),
						},
						input.action === 'wait_for'
							? (input.timeoutMs ?? 5_000) + 5_000
							: undefined,
					);
					return { ...result, action: input.action, tabId };
				} catch (error) {
					return createToolError(
						error instanceof Error ? error.message : String(error),
						'execution',
						{ action: input.action },
					);
				}
			},
		}),
	};
}
