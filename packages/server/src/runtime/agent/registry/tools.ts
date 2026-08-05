import type { AgentToolGroups } from './types.ts';

const baseToolSet = ['progress_update', 'load_tools'] as const;

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') continue;
		const trimmed = item.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

export function normalizeAgentToolConfig(
	value: unknown,
): Required<AgentToolGroups> | undefined {
	if (!value || typeof value !== 'object') return undefined;
	if (Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const firstClass = normalizeStringList(record.firstClass);
	const loadable = normalizeStringList(record.loadable);
	return firstClass.length || loadable.length
		? { firstClass, loadable }
		: undefined;
}

export function flattenAgentToolConfig(
	groups: AgentToolGroups | undefined,
): string[] {
	if (!groups) return [];
	return Array.from(
		new Set([...(groups.firstClass ?? []), ...(groups.loadable ?? [])]),
	);
}

export function normalizeRequiredToolGroups(
	groups: AgentToolGroups,
): Required<AgentToolGroups> {
	return {
		firstClass: Array.from(
			new Set([...(groups.firstClass ?? []), ...baseToolSet]),
		),
		loadable: Array.from(new Set(groups.loadable ?? [])),
	};
}

export function mergeToolGroups(
	base: AgentToolGroups | undefined,
	extra: AgentToolGroups | undefined,
): AgentToolGroups | undefined {
	if (!base && !extra) return undefined;
	const firstClass = Array.from(
		new Set([...(base?.firstClass ?? []), ...(extra?.firstClass ?? [])]),
	);
	const loadable = Array.from(
		new Set([...(base?.loadable ?? []), ...(extra?.loadable ?? [])]),
	);
	return { firstClass, loadable };
}

const defaultToolExtras: Record<string, AgentToolGroups> = {
	build: {
		firstClass: [
			'skill',
			'read',
			'apply_patch',
			'edit',
			'multiedit',
			'write',
			'ls',
			'tree',
			'shell',
			'update_todos',
			'search',
			'git_status',
			'terminal',
			'websearch',
		],
		loadable: [
			'artifact',
			'copy_into',
			'read_image',
			'copy_attachment_to_project',
			'browser',
			'mini_app',
			'forge',
		],
	},
	plan: {
		firstClass: [
			'skill',
			'read',
			'ls',
			'tree',
			'search',
			'update_todos',
			'websearch',
		],
		loadable: ['read_image', 'browser'],
	},
	general: {
		firstClass: [
			'skill',
			'read',
			'ls',
			'tree',
			'shell',
			'search',
			'websearch',
			'update_todos',
		],
		loadable: ['artifact', 'browser', 'forge'],
	},
	git: { firstClass: ['git_status', 'git_diff', 'git_commit', 'read', 'ls'] },
	commit: {
		firstClass: ['git_status', 'git_diff', 'git_commit', 'read', 'ls'],
	},
	research: {
		firstClass: [
			'read',
			'ls',
			'tree',
			'search',
			'websearch',
			'update_todos',
			'query_sessions',
			'query_messages',
			'get_session_context',
			'search_history',
			'present_action',
		],
		loadable: ['read_image', 'copy_attachment_to_project', 'browser'],
	},
	looper: {
		firstClass: ['read', 'ls', 'tree', 'search', 'goal_list', 'goal_update'],
	},
};

export function defaultToolConfigForAgent(
	name: string,
): Required<AgentToolGroups> {
	const extras = defaultToolExtras[name];
	return normalizeRequiredToolGroups(extras ?? {});
}
