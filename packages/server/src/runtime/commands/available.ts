export type AvailableSlashCommand = {
	name: string;
	description: string;
	input?: { hint: string };
};

const AVAILABLE_SLASH_COMMANDS: AvailableSlashCommand[] = [
	{
		name: 'compact',
		description: 'Compact conversation to reduce context size',
	},
	{
		name: 'init',
		description: 'Generate AGENTS.md and .agents docs from the repo structure',
	},
	{
		name: 'handoff',
		description: 'Create a new session with current context',
	},
	{
		name: 'share',
		description: 'Share the current session publicly',
	},
];

/** Returns slash commands that can be sent as chat messages to the server runtime. */
export function listAvailableSlashCommands(): AvailableSlashCommand[] {
	return AVAILABLE_SLASH_COMMANDS;
}
