import type { Tool } from 'ai';
import { buildCopyAttachmentTool } from '../builtin/fs/copy-attachment.ts';
import { buildCopyIntoTool } from '../builtin/fs/copy-into.ts';
import { buildReadImageTool } from '../builtin/fs/read-image.ts';
import { buildBrowserTool } from './browser.ts';
import { buildLoadToolsTool, type LazyToolBrief } from './load-tools.ts';

export type LazyToolDefinition = LazyToolBrief & {
	build: (projectRoot: string) => { name: string; tool: Tool };
};

export function getLazyToolDefinitions(): LazyToolDefinition[] {
	return [
		{
			name: 'copy_into',
			description: 'Copy source lines into a project file.',
			build: buildCopyIntoTool,
		},
		{
			name: 'browser',
			description: 'Open, inspect, and interact with a browser page.',
			build: buildBrowserTool,
		},
		{
			name: 'read_image',
			description: 'Inspect a local image file.',
			build: buildReadImageTool,
		},
		{
			name: 'copy_attachment_to_project',
			description: 'Copy an uploaded attachment into the project.',
			build: buildCopyAttachmentTool,
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
};
export function buildLoadFirstPartyToolsTool(
	allowedNames: Iterable<string> | undefined,
	extraBriefs: LazyToolBrief[],
): { name: string; tool: Tool };
export function buildLoadFirstPartyToolsTool(
	allowedNames?: Iterable<string>,
	extraBriefs: LazyToolBrief[] = [],
): { name: string; tool: Tool } {
	const allowed = allowedNames ? new Set(allowedNames) : null;
	const briefs = [...getLazyToolDefinitions(), ...extraBriefs]
		.filter(({ name }) => !allowed || allowed.has(name))
		.map(({ name, description }) => ({
			name,
			description,
		}));
	return buildLoadToolsTool(briefs);
}
