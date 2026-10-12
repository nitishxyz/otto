import type { PathBase } from '@ottocode/sdk/tools/builtin/fs';

/**
 * Single source of truth for first-party tool facts. Catalog categories,
 * approval sets, Claude Code naming, and path policies derive from here.
 */

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

/**
 * A path-valued input field.
 * - `base`: how relative values are anchored (session cwd or project root).
 * - `sessionDefault`: when the field is missing, empty, or `.`, use the
 *   session cwd (explicit relative values stay project-relative).
 * - `operations`: only applies when `input.operation` is one of these.
 */
export type ToolPathField = {
	field: string;
	access: 'read' | 'write' | 'directory';
	base: PathBase;
	sessionDefault?: boolean;
	operations?: readonly string[];
};

export type ToolDefinitionFacts = {
	name: string;
	category: ToolCatalogCategory;
	source: ToolCatalogSource;
	activation: ToolCatalogActivation;
	required?: boolean;
	risky?: boolean;
	/** `dangerous`: approval in dangerous mode; `safe`: never asks. */
	approval?: 'dangerous' | 'safe';
	claudeCodeName?: string;
	/** Extra PascalCase names accepted from Claude Code callers. */
	claudeCodeAliases?: readonly string[];
	paths?: readonly ToolPathField[];
};

const builtin = (
	facts: Omit<ToolDefinitionFacts, 'source' | 'activation'> &
		Partial<Pick<ToolDefinitionFacts, 'source' | 'activation'>>,
): ToolDefinitionFacts => ({
	source: 'builtin',
	activation: 'first_class',
	...facts,
});

export const TOOL_DEFINITIONS: readonly ToolDefinitionFacts[] = [
	builtin({
		name: 'progress_update',
		category: 'core',
		required: true,
		approval: 'safe',
		claudeCodeName: 'ProgressUpdate',
	}),
	builtin({
		name: 'update_todos',
		category: 'core',
		approval: 'safe',
		claudeCodeName: 'UpdateTodos',
	}),
	builtin({ name: 'finish', category: 'core', claudeCodeName: 'Finish' }),
	builtin({ name: 'load_tools', category: 'first_class', required: true }),
	builtin({
		name: 'read',
		category: 'filesystem',
		claudeCodeName: 'Read',
		paths: [{ field: 'path', access: 'read', base: 'session' }],
	}),
	builtin({
		name: 'read_image',
		category: 'filesystem',
		paths: [{ field: 'path', access: 'read', base: 'project' }],
	}),
	builtin({
		name: 'ls',
		category: 'filesystem',
		claudeCodeName: 'Ls',
		paths: [{ field: 'path', access: 'read', base: 'session' }],
	}),
	builtin({
		name: 'tree',
		category: 'filesystem',
		claudeCodeName: 'Tree',
		paths: [{ field: 'path', access: 'read', base: 'session' }],
	}),
	builtin({
		name: 'cd',
		category: 'filesystem',
		claudeCodeName: 'Cd',
		paths: [{ field: 'path', access: 'directory', base: 'session' }],
	}),
	builtin({ name: 'pwd', category: 'filesystem', claudeCodeName: 'Pwd' }),
	builtin({
		name: 'copy_into',
		category: 'filesystem',
		approval: 'dangerous',
		claudeCodeName: 'CopyInto',
		paths: [
			{ field: 'sourcePath', access: 'read', base: 'project' },
			{ field: 'targetPath', access: 'write', base: 'project' },
		],
	}),
	builtin({
		name: 'copy_attachment_to_project',
		category: 'filesystem',
		paths: [{ field: 'targetPath', access: 'write', base: 'project' }],
	}),
	builtin({
		name: 'write',
		category: 'editing',
		risky: true,
		approval: 'dangerous',
		claudeCodeName: 'Write',
		paths: [{ field: 'path', access: 'write', base: 'session' }],
	}),
	builtin({
		name: 'edit',
		category: 'editing',
		approval: 'dangerous',
		claudeCodeName: 'Edit',
		paths: [{ field: 'path', access: 'write', base: 'project' }],
	}),
	builtin({
		name: 'multiedit',
		category: 'editing',
		approval: 'dangerous',
		claudeCodeName: 'MultiEdit',
		paths: [{ field: 'path', access: 'write', base: 'project' }],
	}),
	builtin({
		name: 'apply_patch',
		category: 'editing',
		risky: true,
		approval: 'dangerous',
		claudeCodeName: 'ApplyPatch',
	}),
	builtin({
		name: 'search',
		category: 'search',
		claudeCodeName: 'Search',
		claudeCodeAliases: ['Grep'],
		paths: [{ field: 'path', access: 'read', base: 'project' }],
	}),
	builtin({
		name: 'shell',
		category: 'shell',
		risky: true,
		approval: 'dangerous',
		claudeCodeName: 'Shell',
		claudeCodeAliases: ['Bash'],
		paths: [
			{
				field: 'cwd',
				access: 'directory',
				base: 'project',
				sessionDefault: true,
			},
		],
	}),
	builtin({
		name: 'bash',
		category: 'shell',
		approval: 'dangerous',
		paths: [
			{
				field: 'cwd',
				access: 'directory',
				base: 'project',
				sessionDefault: true,
			},
		],
	}),
	builtin({
		name: 'terminal',
		category: 'shell',
		risky: true,
		approval: 'dangerous',
		claudeCodeName: 'Terminal',
		paths: [
			{
				field: 'cwd',
				access: 'directory',
				base: 'project',
				operations: ['start'],
			},
		],
	}),
	builtin({ name: 'git_status', category: 'git', claudeCodeName: 'GitStatus' }),
	builtin({ name: 'git_diff', category: 'git', claudeCodeName: 'GitDiff' }),
	builtin({
		name: 'git_commit',
		category: 'git',
		risky: true,
		approval: 'dangerous',
		claudeCodeName: 'GitCommit',
	}),
	builtin({ name: 'git_push', category: 'git', approval: 'dangerous' }),
	builtin({ name: 'websearch', category: 'web', claudeCodeName: 'WebSearch' }),
	builtin({ name: 'skill', category: 'skill', source: 'skill' }),
	builtin({
		name: 'forge',
		category: 'other',
		activation: 'loadable',
		risky: true,
		approval: 'dangerous',
	}),
	builtin({ name: 'load_mcp_tools', category: 'mcp', source: 'mcp' }),
	builtin({ name: 'query_sessions', category: 'research' }),
	builtin({ name: 'query_messages', category: 'research' }),
	builtin({ name: 'get_session_context', category: 'research' }),
	builtin({ name: 'get_parent_session', category: 'research' }),
	builtin({ name: 'search_history', category: 'research' }),
	builtin({ name: 'present_action', category: 'research' }),
	builtin({ name: 'subagent', category: 'orchestration' }),
	builtin({ name: 'remember', category: 'other' }),
	builtin({ name: 'recall_memory', category: 'other' }),
	builtin({ name: 'memory_history', category: 'other' }),
	builtin({
		name: 'forget_memory',
		category: 'other',
		risky: true,
		approval: 'dangerous',
	}),
];

const definitionsByName = new Map(
	TOOL_DEFINITIONS.map((definition) => [definition.name, definition]),
);

export function getToolDefinition(
	name: string,
): ToolDefinitionFacts | undefined {
	return definitionsByName.get(name);
}

export function toolNamesWhere(
	predicate: (definition: ToolDefinitionFacts) => boolean,
): Set<string> {
	return new Set(
		TOOL_DEFINITIONS.filter(predicate).map((definition) => definition.name),
	);
}

/** Path fields that apply to this call, honoring `operations` filters. */
export function getToolPathFields(
	name: string,
	input: unknown,
): ToolPathField[] {
	const fields = getToolDefinition(name)?.paths ?? [];
	const operation =
		input && typeof input === 'object'
			? (input as { operation?: unknown }).operation
			: undefined;
	return fields.filter(
		(field) =>
			!field.operations ||
			(typeof operation === 'string' && field.operations.includes(operation)),
	);
}
