import type { Tool } from 'ai';
import { buildCopyAttachmentTool } from '../builtin/fs/copy-attachment.ts';
import { buildReadImageTool } from '../builtin/fs/read-image.ts';
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
				'Control Apple Simulator via serve-sim: start, status, click, type, button, rotate, screenshot, accessibility tree, foreground app, logs, stop.',
			build: buildSimulatorTool,
		},
		{
			name: 'read_image',
			description:
				'Read and inspect a local image file such as a screenshot, icon, or diagram.',
			build: buildReadImageTool,
		},
		{
			name: 'copy_attachment_to_project',
			description:
				'Copy an original uploaded chat attachment into the project without recompression.',
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
