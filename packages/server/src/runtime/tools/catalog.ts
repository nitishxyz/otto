import {
	discoverProjectTools,
	getLazyToolDefinitions,
	getToolMetadata,
	loadConfig,
	type ToolMetadata,
} from '@ottocode/sdk';
import type { Tool } from 'ai';
import { buildDatabaseTools } from '../../tools/database/index.ts';
import { buildGoalTools } from '../../tools/goals/index.ts';
import { SERVER_LAZY_TOOL_CATALOG } from '../../tools/lazy-catalog.ts';
import { buildSubagentTools } from '../../tools/subagents/index.ts';

const REQUIRED_TOOLS = new Set(['progress_update', 'load_tools']);
const RISKY_TOOLS = new Set([
	'shell',
	'terminal',
	'forge',
	'write',
	'apply_patch',
	'git_commit',
]);

const BUILTIN_TOOLS = new Set([
	'progress_update',
	'update_todos',
	'read',
	'read_image',
	'write',
	'edit',
	'multiedit',
	'copy_into',
	'copy_attachment_to_project',
	'ls',
	'tree',
	'search',
	'shell',
	'terminal',
	'apply_patch',
	'git_status',
	'git_diff',
	'git_commit',
	'websearch',
	'skill',
	'forge',
	'load_tools',
	'load_mcp_tools',
]);

const RESEARCH_TOOLS = new Set([
	'query_sessions',
	'query_messages',
	'get_session_context',
	'search_history',
	'present_action',
]);

const ORCHESTRATION_TOOLS = new Set(['subagent', 'goal_list', 'goal_update']);

export type ToolCatalogCategory =
	| 'first_class'
	| 'loadable'
	| 'core'
	| 'filesystem'
	| 'search'
	| 'editing'
	| 'shell'
	| 'git'
	| 'web'
	| 'mcp'
	| 'skill'
	| 'research'
	| 'orchestration'
	| 'custom'
	| 'other';

export type ToolCatalogSource = 'builtin' | 'mcp' | 'skill' | 'custom';
export type ToolCatalogActivation = 'first_class' | 'loadable' | 'mcp';

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
	if (name === 'load_tools') return 'first_class';
	if (['progress_update', 'update_todos'].includes(name)) return 'core';
	if (
		[
			'read',
			'read_image',
			'ls',
			'tree',
			'copy_into',
			'copy_attachment_to_project',
		].includes(name)
	) {
		return 'filesystem';
	}
	if (['edit', 'multiedit', 'write', 'apply_patch'].includes(name)) {
		return 'editing';
	}
	if (name === 'search') return 'search';
	if (['shell', 'terminal'].includes(name)) return 'shell';
	if (name.startsWith('git_')) return 'git';
	if (name === 'websearch') return 'web';
	if (name === 'skill') return 'skill';
	if (RESEARCH_TOOLS.has(name)) return 'research';
	if (ORCHESTRATION_TOOLS.has(name)) return 'orchestration';
	if (name.includes('__') || name === 'load_mcp_tools') return 'mcp';
	if (BUILTIN_TOOLS.has(name)) return 'other';
	return 'custom';
}

function getToolSource(
	name: string,
	options: { mcp: boolean },
): ToolCatalogSource {
	if (options.mcp || name.includes('__') || name === 'load_mcp_tools')
		return 'mcp';
	if (name === 'skill') return 'skill';
	if (
		BUILTIN_TOOLS.has(name) ||
		RESEARCH_TOOLS.has(name) ||
		ORCHESTRATION_TOOLS.has(name)
	)
		return 'builtin';
	return 'custom';
}

function toToolCatalogEntry(args: {
	name: string;
	tool?: Tool;
	metadata?: ToolMetadata;
	mcp?: boolean;
	available?: boolean;
	activation?: ToolCatalogActivation;
}): ToolCatalogEntry {
	return {
		name: args.name,
		description: getToolDescription(args.tool),
		category: getToolCategory(args.name),
		source: getToolSource(args.name, { mcp: Boolean(args.mcp) }),
		activation: args.activation ?? (args.mcp ? 'mcp' : 'first_class'),
		required: REQUIRED_TOOLS.has(args.name) || undefined,
		risky:
			RISKY_TOOLS.has(args.name) ||
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
	const discovered = await discoverProjectTools(cfg.projectRoot, cfg.skills);
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

	for (const item of buildDatabaseTools(cfg.projectRoot, null)) {
		details.set(
			item.name,
			toToolCatalogEntry({ name: item.name, tool: item.tool }),
		);
	}

	for (const item of [
		...buildSubagentTools(cfg.projectRoot, ''),
		...buildGoalTools({ projectRoot: cfg.projectRoot, looperSessionId: '' }),
	]) {
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
		details.set(name, toToolCatalogEntry({ name, tool, mcp: true }));
	}

	return Array.from(details.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}
