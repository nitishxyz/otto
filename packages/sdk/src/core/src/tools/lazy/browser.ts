import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { createToolError } from '../error.ts';

const browserActions = ['open'] as const;
const browserKinds = ['browser', 'simulator'] as const;

const browserInputSchema = z.object({
	action: z.enum(browserActions),
	url: z
		.string()
		.optional()
		.describe('URL to open in Otto built-in browser preview.'),
	title: z.string().optional().describe('Optional browser tab title.'),
	kind: z
		.enum(browserKinds)
		.optional()
		.describe('Use simulator for serve-sim previews; otherwise use browser.'),
	newTab: z
		.boolean()
		.optional()
		.describe(
			'Open a new browser tab instead of reusing the browser preview tab.',
		),
});

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

export function buildBrowserTool(_projectRoot: string): {
	name: string;
	tool: Tool;
} {
	return {
		name: 'browser',
		tool: tool({
			description:
				'Open a URL in Otto built-in browser preview so the user can see a running app, hosted page, or serve-sim simulator preview. This tool is for display only; it does not provide browser automation or page inspection yet. Use action=open with a URL. For iOS Simulator previews, start serve-sim with the simulator tool or terminal, then open http://localhost:3200 with this browser tool.',
			inputSchema: browserInputSchema,
			execute: async (input) => {
				try {
					switch (input.action) {
						case 'open': {
							const url = validateBrowserUrl(input.url ?? '');
							const kind = input.kind ?? 'browser';
							const title =
								input.title ?? (kind === 'simulator' ? 'Simulator' : 'Browser');
							return {
								ok: true,
								action: 'open',
								url,
								title,
								kind,
								newTab: input.newTab ?? false,
								message: `Opened ${url} in Otto built-in browser preview`,
							};
						}
					}
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
