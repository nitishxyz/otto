/**
 * Tool name mapping for Claude Code OAuth compatibility.
 *
 * Claude Code OAuth requires PascalCase tool names but does NOT whitelist
 * specific tools. Any tool with a PascalCase name is accepted.
 *
 * Known names derive from the tool definition registry; other names use a
 * snake_case → PascalCase conversion. Registration rejects collisions.
 */

import { TOOL_DEFINITIONS } from './definitions.ts';

export type ToolNamingConvention = 'canonical' | 'claude-code';

/** Mapping from otto canonical names to PascalCase names. */
export const CANONICAL_TO_PASCAL: Record<string, string> = Object.fromEntries(
	TOOL_DEFINITIONS.flatMap((definition) =>
		definition.claudeCodeName
			? [[definition.name, definition.claudeCodeName]]
			: [],
	),
);

/** Reverse mapping from PascalCase names (including aliases) to canonical. */
export const PASCAL_TO_CANONICAL: Record<string, string> = Object.fromEntries([
	...TOOL_DEFINITIONS.flatMap((definition) =>
		(definition.claudeCodeAliases ?? []).map((alias) => [
			alias,
			definition.name,
		]),
	),
	...TOOL_DEFINITIONS.flatMap((definition) =>
		definition.claudeCodeName
			? [[definition.claudeCodeName, definition.name]]
			: [],
	),
]);

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

export type RegistrationCollision = {
	registration: string;
	kept: string;
	rejected: string;
};

/**
 * Computes provider-facing registration names for canonical tool names.
 * When two different tools would register under the same name, the first
 * keeps it and later ones are rejected (never silently remapped).
 */
export function buildRegistrationNames(
	canonicalNames: readonly string[],
	useClaudeCodeNaming: boolean,
): { names: Map<string, string>; collisions: RegistrationCollision[] } {
	const byRegistration = new Map<string, string>();
	const names = new Map<string, string>();
	const collisions: RegistrationCollision[] = [];
	for (const canonical of canonicalNames) {
		const registration = useClaudeCodeNaming
			? toClaudeCodeName(canonical)
			: canonical;
		const existing = byRegistration.get(registration);
		if (existing !== undefined && existing !== canonical) {
			collisions.push({ registration, kept: existing, rejected: canonical });
			continue;
		}
		byRegistration.set(registration, canonical);
		names.set(canonical, registration);
	}
	return { names, collisions };
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
