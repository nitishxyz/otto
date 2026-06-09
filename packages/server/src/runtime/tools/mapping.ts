/**
 * Tool name mapping for Claude Code OAuth compatibility.
 *
 * Claude Code OAuth requires PascalCase tool names but does NOT whitelist
 * specific tools. Any tool with a PascalCase name is accepted.
 *
 * This module provides bidirectional mapping between otto's canonical
 * snake_case names and the PascalCase format required for OAuth.
 */

export type ToolNamingConvention = 'canonical' | 'claude-code';

/**
 * Mapping from otto canonical names to PascalCase names.
 * Includes ALL otto tools for complete OAuth compatibility.
 */
export const CANONICAL_TO_PASCAL: Record<string, string> = {
	// File system operations
	read: 'Read',
	edit: 'Edit',
	multiedit: 'MultiEdit',
	write: 'Write',
	copy_into: 'CopyInto',
	ls: 'Ls',
	tree: 'Tree',
	cd: 'Cd',
	pwd: 'Pwd',

	// Search operations
	glob: 'Glob',
	search: 'Search',

	// Execution
	shell: 'Shell',
	bash: 'Shell',
	terminal: 'Terminal',

	// Git operations
	git_status: 'GitStatus',
	git_diff: 'GitDiff',
	git_commit: 'GitCommit',

	// Patch
	apply_patch: 'ApplyPatch',

	// Task management
	update_todos: 'UpdateTodos',
	progress_update: 'ProgressUpdate',
	finish: 'Finish',

	// Web operations
	websearch: 'WebSearch',
};

/**
 * Reverse mapping from PascalCase names to canonical.
 * Built to handle Claude Code style tool names.
 */
export const PASCAL_TO_CANONICAL: Record<string, string> = {
	// File system operations
	Read: 'read',
	Edit: 'edit',
	MultiEdit: 'multiedit',
	Write: 'write',
	CopyInto: 'copy_into',
	Ls: 'ls',
	Tree: 'tree',
	Cd: 'cd',
	Pwd: 'pwd',

	// Search operations
	Glob: 'glob',
	Grep: 'search',
	Search: 'search',

	// Execution
	Shell: 'shell',
	Bash: 'shell',
	Terminal: 'terminal',

	// Git operations
	GitStatus: 'git_status',
	GitDiff: 'git_diff',
	GitCommit: 'git_commit',

	// Patch
	ApplyPatch: 'apply_patch',

	// Task management
	UpdateTodos: 'update_todos',
	ProgressUpdate: 'progress_update',
	Finish: 'finish',

	// Web operations
	WebSearch: 'websearch',
};

/**
 * Convert a canonical tool name to PascalCase format.
 */
export function toClaudeCodeName(canonical: string): string {
	if (CANONICAL_TO_PASCAL[canonical]) {
		return CANONICAL_TO_PASCAL[canonical];
	}
	// Default: convert snake_case to PascalCase
	return canonical
		.split(/[\s_]+/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');
}

/**
 * Convert a PascalCase tool name to canonical format.
 */
export function toCanonicalName(pascalCase: string): string {
	if (PASCAL_TO_CANONICAL[pascalCase]) {
		return PASCAL_TO_CANONICAL[pascalCase];
	}
	// Default: convert PascalCase to snake_case
	return pascalCase
		.replace(/([A-Z])/g, '_$1')
		.toLowerCase()
		.replace(/^_/, '');
}

/**
 * Check if the current provider/auth combo requires PascalCase naming.
 */
export function requiresClaudeCodeNaming(
	provider: string,
	authType?: string,
): boolean {
	return provider === 'anthropic' && authType === 'oauth';
}

/**
 * Transform a tool definition for Claude Code OAuth.
 * Returns a new object with the transformed name.
 */
export function transformToolForClaudeCode<T extends { name: string }>(
	tool: T,
): T {
	return {
		...tool,
		name: toClaudeCodeName(tool.name),
	};
}

/**
 * Transform tool call arguments to canonical names.
 * Used when receiving tool calls from Claude Code OAuth.
 */
export function normalizeToolCall<T extends { name: string }>(
	call: T,
	fromClaudeCode: boolean,
): T {
	if (!fromClaudeCode) return call;
	return {
		...call,
		name: toCanonicalName(call.name),
	};
}
