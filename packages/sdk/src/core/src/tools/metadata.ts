import type { Tool } from 'ai';
import type { PluginToolEffect } from '../../../plugins/index.ts';
import type { ToolSensitiveInput } from './policy/sensitive-input.ts';

export type ToolSourceKind = 'builtin' | 'extension' | 'mcp';

/** Activation bucket; matches the wire value used by tool catalogs. */
export type ToolActivation = 'first_class' | 'loadable' | 'mcp';

export type ToolMetadata = {
	source: ToolSourceKind;
	plugin?: string;
	version?: string;
	activation?: ToolActivation;
	effects?: PluginToolEffect[];
	/** Input fields holding secrets; redacted before persistence and events. */
	sensitiveInputs?: ToolSensitiveInput[];
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

/** Sensitive input declarations for a tool, if any. */
export function getToolSensitiveInputs(
	tool: Tool | undefined,
): ToolSensitiveInput[] | undefined {
	return getToolMetadata(tool)?.sensitiveInputs;
}
