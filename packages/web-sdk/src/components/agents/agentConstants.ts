import type { AgentDetail, ToolDetail } from '../../hooks/useAgents';

export const REQUIRED_TOOLS = new Set(['progress_update', 'load_tools']);
export const RISKY_TOOLS = new Set([
	'shell',
	'terminal',
	'write',
	'apply_patch',
	'git_commit',
]);

export type AgentEditorPage = 'overview' | 'prompt' | 'tools';

export const AGENT_EDITOR_PAGES: Array<{
	id: AgentEditorPage;
	label: string;
}> = [
	{ id: 'overview', label: 'Overview' },
	{ id: 'prompt', label: 'Prompt' },
	{ id: 'tools', label: 'Tools' },
];

export type ToolDisplay = {
	name: string;
	enabled: boolean;
	category: string;
	activation?: ToolDetail['activation'];
	description?: string;
	required?: boolean;
	risky?: boolean;
	available?: boolean;
};

export function getAgentConfigScope(agent: AgentDetail): 'local' | 'global' {
	if (agent.builtin) return 'global';
	if (agent.source === 'global') return 'global';
	if (agent.hasGlobalOverride && !agent.hasLocalOverride) return 'global';
	return 'local';
}

export function toolCategoryFromName(tool: string): string {
	if (tool === 'load_tools') return 'First-class tools';
	if (
		[
			'simulator',
			'read_image',
			'copy_attachment_to_project',
			'mcp_manager',
		].includes(tool)
	)
		return 'Loadable tools';
	if (['progress_update', 'update_todos'].includes(tool))
		return 'First-class tools';
	if (
		[
			'read',
			'read_image',
			'ls',
			'tree',
			'copy_into',
			'copy_attachment_to_project',
		].includes(tool)
	)
		return 'Filesystem';
	if (['edit', 'multiedit', 'write', 'apply_patch'].includes(tool))
		return 'Editing';
	if (['search'].includes(tool)) return 'Search';
	if (['shell', 'terminal'].includes(tool)) return 'Shell';
	if (tool.startsWith('git_')) return 'Git';
	if (tool === 'websearch') return 'Web';
	if (
		[
			'query_sessions',
			'query_messages',
			'get_session_context',
			'search_history',
			'present_action',
		].includes(tool)
	)
		return 'Research';
	if (tool.includes('__')) return 'MCP';
	if (tool === 'skill') return 'Skills';
	return 'Other';
}

export function formatToolCategory(
	category: ToolDetail['category'] | string,
): string {
	if (category === 'first_class') return 'First-class tools';
	if (category === 'loadable') return 'Loadable tools';
	return category
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export function groupTools(
	tools: ToolDisplay[],
): Array<[string, ToolDisplay[]]> {
	const groups = new Map<string, ToolDisplay[]>();
	for (const tool of tools) {
		const group =
			tool.activation === 'loadable'
				? 'Loadable tools'
				: tool.activation === 'mcp'
					? 'MCP tools'
					: 'First-class tools';
		const list = groups.get(group) ?? [];
		list.push(tool);
		groups.set(group, list);
	}
	return Array.from(groups.entries()).map(([category, list]) => [
		category,
		list.sort((a, b) => a.name.localeCompare(b.name)),
	]);
}

const FALLBACK_LOADABLE_TOOLS = new Set([
	'read_image',
	'copy_attachment_to_project',
	'simulator',
	'mcp_manager',
]);

export function buildAgentToolConfig(
	toolNames: Iterable<string>,
	availableTools: ToolDetail[],
	toolBuckets: Record<string, 'first_class' | 'loadable'> = {},
): { firstClass: string[]; loadable: string[] } {
	const byName = new Map(availableTools.map((tool) => [tool.name, tool]));
	const firstClass = new Set<string>();
	const loadable = new Set<string>();
	for (const toolName of toolNames) {
		const overrideBucket = toolBuckets[toolName];
		if (overrideBucket === 'loadable') {
			loadable.add(toolName);
			continue;
		}
		if (overrideBucket === 'first_class') {
			firstClass.add(toolName);
			continue;
		}
		const detail = byName.get(toolName);
		if (
			detail?.activation === 'loadable' ||
			FALLBACK_LOADABLE_TOOLS.has(toolName)
		) {
			loadable.add(toolName);
		} else {
			firstClass.add(toolName);
		}
	}
	for (const requiredTool of REQUIRED_TOOLS) firstClass.add(requiredTool);
	return {
		firstClass: Array.from(firstClass).sort(),
		loadable: Array.from(loadable).sort(),
	};
}

export function toolBucketsFromConfig(config?: {
	firstClass?: string[];
	loadable?: string[];
}): Record<string, 'first_class' | 'loadable'> {
	const buckets: Record<string, 'first_class' | 'loadable'> = {};
	for (const name of config?.firstClass ?? []) buckets[name] = 'first_class';
	for (const name of config?.loadable ?? []) buckets[name] = 'loadable';
	return buckets;
}

export function normalizeAgentToolConfig(config?: {
	firstClass?: string[];
	loadable?: string[];
}): { firstClass: string[]; loadable: string[] } {
	return {
		firstClass: Array.from(new Set(config?.firstClass ?? [])).sort(),
		loadable: Array.from(new Set(config?.loadable ?? [])).sort(),
	};
}

export function toolNamesFromConfig(config?: {
	firstClass?: string[];
	loadable?: string[];
}): string[] {
	return Array.from(
		new Set([...(config?.firstClass ?? []), ...(config?.loadable ?? [])]),
	).sort();
}

export const BLANK_AGENT_PROMPT = `You are a focused assistant. Follow the user's instructions carefully, use only the tools available to you, and finish with a concise summary of the result.`;

export const TOOL_PRESETS: Record<
	string,
	{
		label: string;
		tools: { firstClass?: string[]; loadable?: string[] };
	}
> = {
	'read-only': {
		label: 'Read-only',
		tools: {
			firstClass: [
				'progress_update',
				'read',
				'ls',
				'tree',
				'search',
				'websearch',
			],
			loadable: ['read_image', 'browser'],
		},
	},
	planning: {
		label: 'Planning',
		tools: {
			firstClass: [
				'progress_update',
				'update_todos',
				'read',
				'ls',
				'tree',
				'search',
				'websearch',
			],
			loadable: ['read_image', 'browser'],
		},
	},
	research: {
		label: 'Research',
		tools: {
			firstClass: [
				'progress_update',
				'update_todos',
				'read',
				'ls',
				'tree',
				'search',
				'websearch',
				'query_sessions',
				'query_messages',
				'get_session_context',
				'search_history',
				'present_action',
			],
			loadable: ['read_image', 'browser'],
		},
	},
};
