import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { buildBrowserPanelTool } from './browser-panel.ts';
import { buildSimulatorTool } from './simulator.ts';

export type BuiltinToolsetId = 'browser' | 'simulator' | 'mobile';

export type BuiltinToolBrief = {
	name: string;
	toolset: BuiltinToolsetId;
	description: string;
};

type ToolsetDefinition = {
	id: BuiltinToolsetId;
	description: string;
	tools: () => Array<{ name: string; tool: Tool }>;
};

const TOOLSETS: ToolsetDefinition[] = [
	{
		id: 'browser',
		description:
			'List, open, navigate, reload, close, scroll, inspect, and send basic input to tabs in the right Browser panel.',
		tools: () => [buildBrowserPanelTool()],
	},
	{
		id: 'simulator',
		description:
			'Start/view/control iOS Simulator sessions, launch apps, open deep links, install .app bundles, capture screenshots, read logs, and send gestures/buttons.',
		tools: () => [buildSimulatorTool()],
	},
	{
		id: 'mobile',
		description:
			'Load both Browser panel and iOS Simulator tools for mobile preview workflows.',
		tools: () => [buildBrowserPanelTool(), buildSimulatorTool()],
	},
];

export function getBuiltinToolBriefs(): BuiltinToolBrief[] {
	const briefs = new Map<string, BuiltinToolBrief>();
	for (const toolset of TOOLSETS) {
		for (const { name, tool: t } of toolset.tools()) {
			briefs.set(name, {
				name,
				toolset: toolset.id,
				description: t.description ?? `${toolset.id} tool: ${name}`,
			});
		}
	}
	return [...briefs.values()];
}

export function getBuiltinLazyToolsRecord(): Record<string, Tool> {
	const record: Record<string, Tool> = {};
	for (const toolset of TOOLSETS) {
		for (const { name, tool: t } of toolset.tools()) {
			record[name] = t;
		}
	}
	return record;
}

function buildCatalog() {
	return TOOLSETS.map(
		(toolset) => `- ${toolset.id}: ${toolset.description}`,
	).join('\n');
}

export function buildLoadBuiltinToolsetTool(): { name: string; tool: Tool } {
	const definitions = new Map(TOOLSETS.map((toolset) => [toolset.id, toolset]));
	return {
		name: 'load_builtin_toolset',
		tool: tool({
			description: `Load optional first-party toolsets so their tools become available in the next step.\n\nAvailable toolsets:\n${buildCatalog()}`,
			inputSchema: z.object({
				toolsets: z
					.array(z.enum(['browser', 'simulator', 'mobile']))
					.describe('Toolsets to load, e.g. ["browser", "simulator"].'),
			}),
			execute: async ({ toolsets }) => {
				const loaded: string[] = [];
				for (const id of toolsets) {
					const definition = definitions.get(id);
					if (!definition) continue;
					for (const { name } of definition.tools()) {
						if (!loaded.includes(name)) loaded.push(name);
					}
				}
				return {
					ok: true,
					loaded,
					message:
						loaded.length > 0
							? `Loaded ${loaded.length} builtin tool(s). They are now available for use.`
							: 'No builtin tools loaded.',
				};
			},
		}),
	};
}
