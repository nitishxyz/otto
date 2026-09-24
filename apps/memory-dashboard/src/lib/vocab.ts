import type {
	EdgeType,
	GraphNode,
	MemoryOrigin,
	MemoryScope,
	MemoryStatus,
} from '../types.ts';

/** Last path segment of a project root, e.g. `/Users/me/dev/agi` -> `agi`. */
export function projectName(projectId: string | undefined): string {
	if (!projectId) return 'Unknown project';
	const trimmed = projectId.replace(/[\\/]+$/, '');
	const parts = trimmed.split(/[\\/]/);
	return parts[parts.length - 1] || trimmed || 'Unknown project';
}

export const SCOPE_NAMES: Record<MemoryScope, string> = {
	global: 'About you',
	project: 'This project',
	session: 'One chat only',
};

export const SCOPE_HINTS: Record<MemoryScope, string> = {
	global: 'Applies everywhere you use Otto',
	project: 'Only used when working in this project',
	session: 'Only used within a single chat session',
};

/** Plain-language "where does this apply" label plus a tooltip. */
export function scopeLabel(node: Pick<GraphNode, 'scope' | 'projectId'>): {
	text: string;
	title: string;
} {
	if (node.scope === 'global') {
		return { text: SCOPE_NAMES.global, title: SCOPE_HINTS.global };
	}
	const where = node.projectId ? ` (${node.projectId})` : '';
	if (node.scope === 'session') {
		return {
			text: node.projectId
				? `One chat in ${projectName(node.projectId)}`
				: SCOPE_NAMES.session,
			title: `${SCOPE_HINTS.session}${where}`,
		};
	}
	return {
		text: node.projectId ? projectName(node.projectId) : SCOPE_NAMES.project,
		title: `${SCOPE_HINTS.project}${where}`,
	};
}

export const ORIGIN_NAMES: Record<MemoryOrigin, string> = {
	explicit: 'You told Otto',
	inferred: 'Otto noticed',
};

export const STATUS_NAMES: Record<MemoryStatus, string> = {
	current: 'Current',
	superseded: 'Replaced',
	forgotten: 'Forgotten',
};

/** Legend wording for each edge type. */
export const EDGE_NAMES: Record<EdgeType, string> = {
	supersedes: 'Replaced by newer',
	refines: 'Adds detail',
	contradicts: 'Conflicts',
	relates_to: 'Related',
	about: 'Topic',
	derived_from: 'Source',
};

/**
 * How a related memory relates to the one being viewed. `outgoing` is true
 * when the viewed memory is the edge's `from` end.
 */
export function relationPhrase(type: EdgeType, outgoing: boolean): string {
	switch (type) {
		case 'supersedes':
			return outgoing ? 'Replaces' : 'Replaced by';
		case 'refines':
			return outgoing ? 'Adds detail to' : 'Detailed by';
		case 'contradicts':
			return 'Conflicts with';
		case 'relates_to':
			return 'Related';
		case 'about':
			return 'About';
		case 'derived_from':
			return 'From';
	}
}

const INTERNAL_AGENTS = new Set([
	'',
	'otto',
	'mcp',
	'build',
	'general',
	'plan',
	'unknown',
]);

const AGENT_NAMES: Record<string, string> = {
	codex: 'Codex',
	claude: 'Claude',
	'claude-code': 'Claude Code',
	cursor: 'Cursor',
	opencode: 'OpenCode',
};

/** `"via Codex"` for external agents; `null` for Otto's own/internal agents. */
export function agentPhrase(agent: string | undefined): string | null {
	const key = (agent ?? '').trim().toLowerCase();
	if (INTERNAL_AGENTS.has(key)) return null;
	const name =
		AGENT_NAMES[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
	return `via ${name}`;
}

export function pluralize(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}
