import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import DESCRIPTION from './browser-panel.txt' with { type: 'text' };
import {
	enqueueBrowserPanelCommand,
	getBrowserPanelState,
	waitForBrowserPanelCommandResult,
} from '../../browser-panel/commands.ts';
import { createToolError } from '../error.ts';

function normalizeUrl(input: string) {
	const trimmed = input.trim();
	if (!trimmed) return 'about:blank';
	if (
		trimmed === 'about:blank' ||
		trimmed.startsWith('http://') ||
		trimmed.startsWith('https://')
	) {
		return trimmed;
	}
	if (
		trimmed.includes('localhost') ||
		trimmed.includes('.') ||
		trimmed.includes(':')
	) {
		return `http://${trimmed}`;
	}
	return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function buildBrowserPanelTool(): { name: string; tool: Tool } {
	const browserPanel = tool({
		description: DESCRIPTION,
		inputSchema: z.object({
			operation: z
				.enum([
					'open',
					'navigate',
					'reload',
					'close',
					'click',
					'type',
					'press',
					'scroll',
					'inspect',
					'screenshot',
					'list',
				])
				.describe('Browser panel operation'),
			url: z
				.string()
				.optional()
				.describe('URL for open/navigate. Accepts localhost:3000 shorthand.'),
			selector: z
				.string()
				.optional()
				.describe('CSS selector for click/type operations'),
			text: z.string().optional().describe('Text for type operations'),
			key: z.string().optional().describe('Keyboard key for press operations'),
			x: z.number().optional().describe('Horizontal scroll delta in pixels'),
			y: z.number().optional().describe('Vertical scroll delta in pixels'),
			title: z.string().optional().describe('Optional browser tab title'),
			kind: z
				.enum(['web', 'simulator'])
				.optional()
				.describe('Tab kind. Use simulator for serve-sim URLs.'),
			tabId: z
				.string()
				.optional()
				.describe('Optional target tab ID for navigate/reload/close/control'),
		}),
		execute: async (params) => {
			const enqueueAndWait = async (
				command: Parameters<typeof enqueueBrowserPanelCommand>[0],
			) => {
				const queued = enqueueBrowserPanelCommand(command);
				const result = await waitForBrowserPanelCommandResult(queued.id);
				return { ok: result.ok, command: queued, result };
			};

			switch (params.operation) {
				case 'list': {
					return { ok: true, state: getBrowserPanelState() };
				}
				case 'open': {
					if (!params.url) return createToolError('url is required for open');
					const command = enqueueBrowserPanelCommand({
						type: 'open',
						url: normalizeUrl(params.url),
						title: params.title,
						kind: params.kind,
					});
					return { ok: true, command };
				}
				case 'navigate': {
					if (!params.url)
						return createToolError('url is required for navigate');
					const command = enqueueBrowserPanelCommand({
						type: 'navigate',
						tabId: params.tabId,
						url: normalizeUrl(params.url),
						title: params.title,
					});
					return { ok: true, command };
				}
				case 'reload': {
					const command = enqueueBrowserPanelCommand({
						type: 'reload',
						tabId: params.tabId,
					});
					return { ok: true, command };
				}
				case 'close': {
					const command = enqueueBrowserPanelCommand({
						type: 'close',
						tabId: params.tabId,
					});
					return { ok: true, command };
				}
				case 'click': {
					if (!params.selector)
						return createToolError('selector is required for click');
					return enqueueAndWait({
						type: 'click',
						tabId: params.tabId,
						selector: params.selector,
					});
				}
				case 'type': {
					if (!params.selector)
						return createToolError('selector is required for type');
					if (params.text === undefined)
						return createToolError('text is required for type');
					return enqueueAndWait({
						type: 'type',
						tabId: params.tabId,
						selector: params.selector,
						text: params.text,
					});
				}
				case 'press': {
					if (!params.key) return createToolError('key is required for press');
					return enqueueAndWait({
						type: 'press',
						tabId: params.tabId,
						key: params.key,
					});
				}
				case 'scroll': {
					return enqueueAndWait({
						type: 'scroll',
						tabId: params.tabId,
						x: params.x,
						y: params.y ?? 600,
					});
				}
				case 'inspect': {
					return enqueueAndWait({
						type: 'inspect',
						tabId: params.tabId,
						selector: params.selector,
					});
				}
				case 'screenshot': {
					return enqueueAndWait({
						type: 'screenshot',
						tabId: params.tabId,
					});
				}
			}
		},
	});

	return { name: 'browser_panel', tool: browserPanel };
}
