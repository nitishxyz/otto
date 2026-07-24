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
	agent: 'agents',
};

export function resolveCommand(name: string): string {
	return COMMAND_ALIASES[name] || name;
}

export const COMMANDS = [
	{ name: 'skills', alias: '/k', description: 'Manage skill toggles' },
	{ name: 'mcp', alias: '/p', description: 'Manage MCP servers' },
	{ name: 'models', alias: '/m', description: 'Open model selector' },
	{
		name: 'agents',
		alias: '/g',
		description: 'Switch agent (build, plan, general, …)',
	},
	{ name: 'new', alias: '', description: 'Create a new session' },
	{
		name: 'send',
		alias: '',
		description: 'Send a queued message now (/send [position])',
	},
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
