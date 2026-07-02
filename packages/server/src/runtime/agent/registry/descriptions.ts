export const BUILTIN_AGENT_NAMES = [
	'build',
	'plan',
	'general',
	'init',
	'research',
	'looper',
];

/**
 * Built-in agents that are internal-only and must not be exposed in agent
 * listings (UI pickers, ACP modes, delegation lists). They remain resolvable
 * when explicitly requested (e.g. the /init command). Looper is intentionally
 * NOT hidden: it is listed and editable so users can set its provider/model.
 */
export const HIDDEN_BUILTIN_AGENT_NAMES = ['init'];

const hiddenAgentSet = new Set(HIDDEN_BUILTIN_AGENT_NAMES);

/** Returns true when an agent is internal-only and hidden from listings. */
export function isHiddenAgent(name: string): boolean {
	return hiddenAgentSet.has(name);
}

/** One-line descriptions for built-in agents, used in delegation prompts. */
export const BUILTIN_AGENT_DESCRIPTIONS: Record<string, string> = {
	build:
		'Full coding agent: edits files, runs commands, builds, tests, and delegates.',
	plan: 'Read-only planner: explores the codebase and produces plans, no edits.',
	general:
		'General-purpose assistant for questions and light repo exploration.',
	init: 'Sets up AGENTS.md and project conventions for a repository.',
	research:
		'Searches session history and past conversations to answer questions.',
	looper:
		'Project orchestrator: plans goals, dispatches workers, verifies results.',
};

/** Maximum length of an agent description after normalization. */
export const MAX_AGENT_DESCRIPTION_LENGTH = 120;

/** Normalizes an agent description to a single trimmed line, capped in length. */
export function normalizeAgentDescription(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const oneLine = value.replace(/\s+/g, ' ').trim();
	if (!oneLine) return undefined;
	return oneLine.length > MAX_AGENT_DESCRIPTION_LENGTH
		? `${oneLine.slice(0, MAX_AGENT_DESCRIPTION_LENGTH - 1)}…`
		: oneLine;
}
