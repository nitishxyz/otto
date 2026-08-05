import type { Tool } from 'ai';
import { buildFsTools } from './builtin/fs/index.ts';
import { buildGitTools } from './builtin/git.ts';
import { progressUpdateTool } from './builtin/progress.ts';
import { buildShellTool } from './builtin/shell.ts';
import { buildSearchTool } from './builtin/search.ts';
import { buildApplyPatchTool } from './builtin/patch.ts';
import { updateTodosTool } from './builtin/todos.ts';
import { buildWebSearchTool } from './builtin/websearch.ts';
import { buildTerminalTool } from './builtin/terminal.ts';
import type { TerminalManager } from '../terminals/index.ts';
import {
	initializeSkills,
	buildSkillTool,
	setSkillSettings,
} from '../../../skills/index.ts';
import { getMCPManager } from '../mcp/index.ts';
import {
	getMCPToolBriefs,
	buildLoadMCPToolsTool,
	getMCPToolsRecord,
	type MCPToolBrief,
} from '../mcp/lazy-tools.ts';
import {
	buildLazyToolsRecord,
	buildLoadFirstPartyToolsTool,
} from './lazy/index.ts';
import { discoverNativeExtensionTools } from './extensions/index.ts';
import { getToolMetadata, type ToolMetadata } from './metadata.ts';
import { logger } from '../utils/logger.ts';

export type DiscoveredTool = {
	name: string;
	tool: Tool;
	metadata?: ToolMetadata;
};

export type DiscoverResult = {
	tools: DiscoveredTool[];
	lazyToolsRecord: Record<string, Tool>;
	mcpToolsRecord: Record<string, Tool>;
};

const legacyTerminalManagerKey = 'legacy';
const terminalManagersByProject = new Map<string, TerminalManager>();
const staticToolDiscoveryCache = new Map<string, Promise<DiscoveredTool[]>>();

export function clearProjectToolDiscoveryCache(projectRoot?: string): void {
	if (!projectRoot) {
		staticToolDiscoveryCache.clear();
		return;
	}
	for (const key of staticToolDiscoveryCache.keys()) {
		if (key.startsWith(`${projectRoot}::`))
			staticToolDiscoveryCache.delete(key);
	}
}

function getTerminalManagerKey(projectRoot?: string): string {
	return projectRoot || legacyTerminalManagerKey;
}

export function setTerminalManager(
	manager: TerminalManager,
	projectRoot?: string,
): void {
	terminalManagersByProject.set(getTerminalManagerKey(projectRoot), manager);
}

export function unsetTerminalManager(projectRoot?: string): void {
	terminalManagersByProject.delete(getTerminalManagerKey(projectRoot));
}

export function getTerminalManager(
	projectRoot?: string,
): TerminalManager | null {
	return (
		terminalManagersByProject.get(getTerminalManagerKey(projectRoot)) ?? null
	);
}

function getStaticToolDiscoveryCacheKey(
	projectRoot: string,
	readOnlyRoots: string[] = [],
): string {
	return `${projectRoot}::${[...readOnlyRoots].sort().join('\0')}`;
}

async function discoverStaticProjectTools(
	projectRoot: string,
	skillSettings?: {
		enabled?: boolean;
		items?: Record<string, { enabled?: boolean }>;
	},
	readOnlyRoots: string[] = [],
): Promise<DiscoveredTool[]> {
	setSkillSettings(skillSettings);
	const cacheKey = getStaticToolDiscoveryCacheKey(projectRoot, readOnlyRoots);
	const cached = staticToolDiscoveryCache.get(cacheKey);
	if (cached) return cached;

	const discoveryPromise = (async () => {
		const tools = new Map<string, Tool>();
		const fsTools = buildFsTools(projectRoot);
		for (const { name, tool } of fsTools.filter(({ name }) => name === 'read'))
			tools.set(name, tool);
		// Put apply_patch before exact replacement tools so models see it as the
		// default editing path after reading files.
		const ap = buildApplyPatchTool(projectRoot);
		tools.set(ap.name, ap.tool);
		for (const { name, tool } of fsTools.filter(({ name }) => name !== 'read'))
			tools.set(name, tool);
		for (const { name, tool } of buildGitTools(projectRoot))
			tools.set(name, tool);
		// Built-ins
		tools.set('progress_update', progressUpdateTool);
		const shell = buildShellTool(projectRoot, readOnlyRoots);
		tools.set(shell.name, shell.tool);
		// Search
		const search = buildSearchTool(projectRoot);
		tools.set(search.name, search.tool);
		// Todo tracking
		tools.set('update_todos', updateTodosTool);
		// Web search
		const ws = buildWebSearchTool();
		tools.set(ws.name, ws.tool);
		// Skills
		await initializeSkills(projectRoot);
		const skillTool = buildSkillTool();
		tools.set(skillTool.name, skillTool.tool);

		for (const extension of await discoverNativeExtensionTools(projectRoot)) {
			if (tools.has(extension.name)) {
				logger.warn(
					`Skipping native extension tool that conflicts with an existing tool: ${extension.name}`,
				);
				continue;
			}
			tools.set(extension.name, extension.tool);
		}
		return Array.from(tools.entries()).map(([name, tool]) => ({
			name,
			tool,
			metadata: getToolMetadata(tool),
		}));
	})();

	staticToolDiscoveryCache.set(cacheKey, discoveryPromise);
	try {
		return await discoveryPromise;
	} catch (error) {
		staticToolDiscoveryCache.delete(cacheKey);
		throw error;
	}
}

export async function discoverProjectTools(
	projectRoot: string,
	skillSettings?: {
		enabled?: boolean;
		items?: Record<string, { enabled?: boolean }>;
	},
	readOnlyRoots: string[] = [],
): Promise<DiscoverResult> {
	setSkillSettings(skillSettings);
	const staticTools = await discoverStaticProjectTools(
		projectRoot,
		skillSettings,
		readOnlyRoots,
	);
	const tools = new Map<string, Tool>(
		staticTools
			.filter(({ metadata }) => metadata?.activation !== 'loadable')
			.map(({ name, tool }) => [name, tool]),
	);

	const terminalManager =
		getTerminalManager(projectRoot) ?? getTerminalManager();
	if (terminalManager) {
		const term = buildTerminalTool(projectRoot, terminalManager);
		tools.set(term.name, term.tool);
	}

	const lazyToolsRecord = buildLazyToolsRecord(projectRoot);
	const extensionLazyBriefs: Array<{ name: string; description: string }> = [];
	for (const item of staticTools) {
		if (item.metadata?.activation !== 'loadable') continue;
		lazyToolsRecord[item.name] = item.tool;
		extensionLazyBriefs.push({
			name: item.name,
			description:
				typeof item.tool.description === 'string'
					? item.tool.description
					: `Native extension tool from ${item.metadata.plugin ?? 'plugin'}`,
		});
	}
	const loadFirstPartyTools = buildLoadFirstPartyToolsTool(
		undefined,
		extensionLazyBriefs,
	);
	tools.set(loadFirstPartyTools.name, loadFirstPartyTools.tool);

	const mcpManager = getMCPManager(projectRoot);
	let mcpToolsRecord: Record<string, Tool> = {};
	let mcpBriefs: MCPToolBrief[] = [];
	if (mcpManager?.started) {
		mcpBriefs = getMCPToolBriefs(mcpManager);
		if (mcpBriefs.length > 0) {
			mcpToolsRecord = getMCPToolsRecord(mcpManager);
			const loadTool = buildLoadMCPToolsTool(mcpBriefs);
			tools.set(loadTool.name, loadTool.tool);
		}
	}

	return {
		tools: Array.from(tools.entries()).map(([name, tool]) => ({
			name,
			tool,
			metadata: getToolMetadata(tool),
		})),
		lazyToolsRecord,
		mcpToolsRecord,
	};
}
