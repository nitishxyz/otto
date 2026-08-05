import type { Tool } from 'ai';
import type { PluginToolEffect } from '../../../plugins/index.ts';

export type ToolSourceKind = 'builtin' | 'extension' | 'mcp';

export type ToolMetadata = {
	source: ToolSourceKind;
	plugin?: string;
	version?: string;
	activation?: 'first-class' | 'loadable' | 'mcp';
	effects?: PluginToolEffect[];
};

const metadataByTool = new WeakMap<object, ToolMetadata>();

export function setToolMetadata(tool: Tool, metadata: ToolMetadata): void {
	metadataByTool.set(tool as object, metadata);
}

export function getToolMetadata(
	tool: Tool | undefined,
): ToolMetadata | undefined {
	if (!tool || typeof tool !== 'object') return undefined;
	return metadataByTool.get(tool as object);
}
