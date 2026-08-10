export interface ParsedCommand {
	name: string;
	args: string;
}

export function parseCommand(input: string): ParsedCommand | null {
	const trimmed = input.trim();
	if (!trimmed.startsWith('/')) return null;

	const spaceIdx = trimmed.indexOf(' ');
	if (spaceIdx === -1) {
		return { name: trimmed.slice(1).toLowerCase(), args: '' };
	}
	return {
		name: trimmed.slice(1, spaceIdx).toLowerCase(),
		args: trimmed.slice(spaceIdx + 1).trim(),
	};
}

export const COMMAND_ALIASES: Record<string, string> = {
	s: 'sessions',
	q: 'exit',
	'?': 'help',
	x: 'stop',
	t: 'theme',
	m: 'models',
	p: 'mcp',
	k: 'skills',
	u: 'usage',
	a: 'approvals',
	g: 'agents',
	w: 'web',
	d: 'dictate',
	agent: 'agents',
};

export function resolveCommand(name: string): string {
	return COMMAND_ALIASES[name] || name;
}

export interface SlashCommand {
	name: string;
	alias: string;
	description: string;
}

export interface RecipeCommandSource {
	name: string;
	scope: 'project' | 'global';
	description: string;
	conflict?: unknown;
}

export const COMMANDS: SlashCommand[] = [
	{ name: 'skills', alias: '/k', description: 'Manage skill toggles' },
	{ name: 'mcp', alias: '/p', description: 'Manage MCP servers' },
	{ name: 'models', alias: '/m', description: 'Open model selector' },
	{ name: 'dictate', alias: '/d', description: 'Start or stop voice input' },
	{
		name: 'agents',
		alias: '/g',
		description: 'Switch agent (build, plan, general, …)',
	},
	{ name: 'new', alias: '', description: 'Create a new session' },
	{ name: 'queue', alias: '', description: 'Manage queued messages' },
	{ name: 'sub-agents', alias: '', description: 'Open sub-agent list' },
	{ name: 'stop', alias: '/x', description: 'Stop current generation' },
	{ name: 'help', alias: '/?', description: 'Show this help' },
	{ name: 'reasoning', alias: '', description: 'Toggle extended thinking' },
	{ name: 'stage', alias: '', description: 'Stage all changes (git add -A)' },
	{ name: 'commit', alias: '', description: 'Open commit overlay' },
	{ name: 'push', alias: '', description: 'Push commits to remote' },
	{ name: 'web', alias: '/w', description: 'Open current session in Web UI' },
	{ name: 'compact', alias: '', description: 'Compact conversation history' },
	{
		name: 'init',
		alias: '',
		description: 'Generate AGENTS.md and .agents docs from the repo structure',
	},
	{
		name: 'handoff',
		alias: '',
		description: 'Create a new session with current context',
	},
	{ name: 'delete', alias: '', description: 'Delete current session' },
	{ name: 'share', alias: '', description: 'Share session publicly' },
	{
		name: 'sync',
		alias: '',
		description: 'Sync new messages to shared session',
	},
	{ name: 'sessions', alias: '/s', description: 'List and switch sessions' },
	{ name: 'theme', alias: '/t', description: 'Switch color theme' },
	{
		name: 'approvals',
		alias: '/a',
		description: 'Configure tool approval mode',
	},
	{ name: 'usage', alias: '/u', description: 'Show OAuth provider usage' },
	{ name: 'clear', alias: '', description: 'Reload messages' },
	{ name: 'exit', alias: '/q', description: 'Exit TUI' },
];

const SERVER_MESSAGE_COMMAND_NAMES = new Set(['compact', 'init']);

/** Returns whether a slash command is handled locally instead of sent as chat. */
export function isLocalTuiCommand(name: string): boolean {
	const command = resolveCommand(name.toLowerCase());
	if (SERVER_MESSAGE_COMMAND_NAMES.has(command)) return false;
	return (
		command === 'provider' || COMMANDS.some((item) => item.name === command)
	);
}

/** Converts invokable recipes into TUI slash-command rows. */
export function recipeSlashCommands(
	recipes: RecipeCommandSource[],
): SlashCommand[] {
	const seen = new Set([
		...COMMANDS.map((command) => command.name),
		...Object.keys(COMMAND_ALIASES),
	]);
	return recipes.flatMap((recipe) => {
		if (recipe.conflict || seen.has(recipe.name)) return [];
		seen.add(recipe.name);
		return [
			{
				name: recipe.name,
				alias: '',
				description: recipe.description
					? `${recipe.description} (${recipe.scope})`
					: `${recipe.scope} recipe`,
			},
		];
	});
}

/** Returns slash commands matching the current query. */
export function getCommandSuggestions(
	query: string,
	extraCommands: SlashCommand[] = [],
): SlashCommand[] {
	const normalizedQuery = query.toLowerCase();
	return [...COMMANDS, ...extraCommands].filter((command) => {
		return (
			!normalizedQuery ||
			command.name.startsWith(normalizedQuery) ||
			command.alias?.slice(1).startsWith(normalizedQuery)
		);
	});
}
