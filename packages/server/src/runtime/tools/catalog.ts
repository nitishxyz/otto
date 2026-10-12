import {
	discoverProjectTools,
	getLazyToolDefinitions,
	getToolMetadata,
	loadConfig,
	type ToolMetadata,
} from '@ottocode/sdk';
import type { Tool } from 'ai';
import { buildDatabaseTools } from '../../tools/database/index.ts';
import { buildMemoryTools } from '../../tools/memory.ts';
import { SERVER_LAZY_TOOL_CATALOG } from '../../tools/lazy-catalog.ts';
import { buildSubagentTools } from '../../tools/subagents/index.ts';
import {
	getToolDefinition,
	type ToolCatalogActivation,
	type ToolCatalogCategory,
	type ToolCatalogSource,
} from './definitions.ts';

export type {
	ToolCatalogActivation,
	ToolCatalogCategory,
	ToolCatalogSource,
} from './definitions.ts';

export type ToolCatalogEntry = {
	name: string;
	description?: string;
	category: ToolCatalogCategory;
	source: ToolCatalogSource;
	activation?: ToolCatalogActivation;
	required?: boolean;
	risky?: boolean;
	available: boolean;
};

function getToolDescription(tool: Tool | undefined): string | undefined {
	const description = (tool as { description?: unknown } | undefined)
		?.description;
	return typeof description === 'string' && description.trim()
		? description.trim()
		: undefined;
}

function getToolCategory(name: string): ToolCatalogCategory {
	const definition = getToolDefinition(name);
	if (definition) return definition.category;
	if (name.includes('__')) return 'mcp';
	return 'custom';
}

function getToolSource(
	name: string,
	options: { mcp: boolean },
): ToolCatalogSource {
	if (options.mcp || name.includes('__')) return 'mcp';
	return getToolDefinition(name)?.source ?? 'custom';
}

function toToolCatalogEntry(args: {
	name: string;
	tool?: Tool;
	metadata?: ToolMetadata;
	mcp?: boolean;
	available?: boolean;
	activation?: ToolCatalogActivation;
}): ToolCatalogEntry {
	const definition = getToolDefinition(args.name);
	return {
		name: args.name,
		description: getToolDescription(args.tool),
		category: getToolCategory(args.name),
		source: getToolSource(args.name, { mcp: Boolean(args.mcp) }),
		activation:
			args.activation ??
			args.metadata?.activation ??
			(args.mcp ? 'mcp' : 'first_class'),
		required: definition?.required || undefined,
		risky:
			definition?.risky ||
			Boolean(
				args.metadata?.effects?.some((effect) => effect !== 'workspace-read'),
			) ||
			undefined,
		available: args.available ?? true,
	};
}

/** Returns the live tool catalog available to agent configurations in a project. */
export async function getProjectToolCatalog(
	projectRoot: string,
): Promise<ToolCatalogEntry[]> {
	const cfg = await loadConfig(projectRoot);
	const discovered = await discoverProjectTools(
		cfg.projectRoot,
		cfg.skills,
		[],
		{ judge: cfg.judge },
	);
	const details = new Map<string, ToolCatalogEntry>();

	for (const item of discovered.tools) {
		details.set(
			item.name,
			toToolCatalogEntry({
				name: item.name,
				tool: item.tool,
				metadata: item.metadata,
			}),
		);
	}

	for (const item of [
		...buildDatabaseTools(cfg.projectRoot, null),
		...(cfg.memory?.enabled === false
			? []
			: buildMemoryTools(
					{ projectRoot: cfg.projectRoot },
					cfg.judge,
					cfg.memory,
				)),
	]) {
		details.set(
			item.name,
			toToolCatalogEntry({ name: item.name, tool: item.tool }),
		);
	}

	for (const item of buildSubagentTools(cfg.projectRoot, '')) {
		details.set(
			item.name,
			toToolCatalogEntry({ name: item.name, tool: item.tool }),
		);
	}

	for (const definition of SERVER_LAZY_TOOL_CATALOG) {
		details.set(definition.name, {
			...toToolCatalogEntry({
				name: definition.name,
				activation: 'loadable',
			}),
			category: 'loadable',
			description: definition.description,
			source: 'builtin',
			available: true,
		});
	}

	const lazyDescriptions = new Map(
		getLazyToolDefinitions().map(({ name, description }) => [
			name,
			description,
		]),
	);
	for (const [name, tool] of Object.entries(discovered.lazyToolsRecord)) {
		const metadata = getToolMetadata(tool);
		const isExtension = metadata?.source === 'extension';
		details.set(name, {
			...toToolCatalogEntry({
				name,
				tool,
				metadata,
				activation: 'loadable',
			}),
			category: isExtension ? 'custom' : 'loadable',
			description: lazyDescriptions.get(name) ?? getToolDescription(tool),
			source: isExtension ? 'custom' : 'builtin',
			available: true,
		});
	}

	for (const [name, tool] of Object.entries(discovered.mcpToolsRecord)) {
		details.set(
			name,
			toToolCatalogEntry({
				name,
				tool,
				metadata: getToolMetadata(tool),
				mcp: true,
			}),
		);
	}

	return Array.from(details.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}
