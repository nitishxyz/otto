import type { Tool } from 'ai';
import { buildCopyAttachmentTool } from '../builtin/fs/copy-attachment.ts';
import { buildReadImageTool } from '../builtin/fs/read-image.ts';
import { buildBrowserTool } from './browser.ts';
import { buildMCPManagerTool } from './mcp-manager.ts';
import { buildSimulatorTool } from './simulator.ts';
import { buildLoadToolsTool, type LazyToolBrief } from './load-tools.ts';

export type LazyToolDefinition = LazyToolBrief & {
	build: (projectRoot: string) => { name: string; tool: Tool };
};

export function getLazyToolDefinitions(): LazyToolDefinition[] {
	return [
		{
			name: 'simulator',
			description:
				'Control Apple Simulator via serve-sim: start, status, click, drag, type, button, rotate, camera, permissions, screenshots, accessibility tree, foreground app, logs, stop.',
			build: buildSimulatorTool,
		},
		{
			name: 'browser',
			description:
				'Open a URL in Otto built-in browser preview for user-visible app, web, or serve-sim previews. Display-only; browser automation controls will be added later.',
			build: buildBrowserTool,
		},
		{
			name: 'read_image',
			description:
				'Read and inspect a local image file. Do not use for images already attached to the current message; those are visible via native vision.',
			build: buildReadImageTool,
		},
		{
			name: 'copy_attachment_to_project',
			description:
				'Copy an uploaded chat attachment into the project only when the user explicitly asks to save/add/copy it.',
			build: buildCopyAttachmentTool,
		},
		{
			name: 'mcp_manager',
			description:
				'Manage otto MCP servers: list, add, update, remove, enable, or disable servers in project (.otto/config.json) or global config.',
			build: buildMCPManagerTool,
		},
	];
}

export function buildLazyToolsRecord(
	projectRoot: string,
): Record<string, Tool> {
	const record: Record<string, Tool> = {};
	for (const definition of getLazyToolDefinitions()) {
		const built = definition.build(projectRoot);
		record[built.name] = built.tool;
	}
	return record;
}

export function buildLoadFirstPartyToolsTool(allowedNames?: Iterable<string>): {
	name: string;
	tool: Tool;
} {
	const allowed = allowedNames ? new Set(allowedNames) : null;
	const briefs = getLazyToolDefinitions()
		.filter(({ name }) => !allowed || allowed.has(name))
		.map(({ name, description }) => ({
			name,
			description,
		}));
	return buildLoadToolsTool(briefs);
}
