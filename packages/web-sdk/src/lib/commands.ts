import {
	Terminal,
	Sparkles,
	Plus,
	Keyboard,
	Code,
	Brain,
	StopCircle,
	GitBranch,
	Check,
	Minimize2,
	Split,
	Trash2,
	Share2,
	RefreshCw,
	FileText,
	ArrowRightLeft,
} from 'lucide-react';

export interface Command {
	id: string;
	label: string;
	description: string | ((state: CommandState) => string);
	icon: typeof Terminal;
	kind: CommandKind;
}

export type CommandKind =
	| 'app'
	| 'runtime'
	| 'git'
	| 'session'
	| 'danger'
	| 'recipe';

export const COMMAND_KIND_LABELS: Record<CommandKind, string> = {
	app: 'App',
	runtime: 'Runtime',
	git: 'Git',
	session: 'Session',
	danger: 'Danger',
	recipe: 'Recipe',
};

export const COMMAND_KIND_STYLES: Record<CommandKind, string> = {
	app: 'text-muted-foreground',
	runtime: 'text-sky-400',
	git: 'text-emerald-400',
	session: 'text-indigo-400',
	danger: 'text-red-400',
	recipe: 'text-purple-400',
};

export interface CommandState {
	vimModeEnabled: boolean;
	reasoningEnabled: boolean;
	isShared?: boolean;
}

export const COMMANDS: Command[] = [
	{
		id: 'models',
		label: '/models',
		description: 'Open model selector',
		icon: Sparkles,
		kind: 'app',
	},
	{
		id: 'agents',
		label: '/agents',
		description: 'Open agent selector',
		icon: Terminal,
		kind: 'app',
	},
	{
		id: 'new',
		label: '/new',
		description: 'Create new session',
		icon: Plus,
		kind: 'session',
	},
	{
		id: 'stop',
		label: '/stop',
		description: 'Stop current generation',
		icon: StopCircle,
		kind: 'danger',
	},
	{
		id: 'help',
		label: '/help',
		description: 'Show keyboard shortcuts and help',
		icon: Keyboard,
		kind: 'app',
	},
	{
		id: 'vim',
		label: '/vim',
		description: (state) =>
			state.vimModeEnabled ? 'Disable Vim mode' : 'Enable Vim mode',
		icon: Code,
		kind: 'app',
	},
	{
		id: 'reasoning',
		label: '/reasoning',
		description: (state) =>
			state.reasoningEnabled
				? 'Disable extended thinking'
				: 'Enable extended thinking',
		icon: Brain,
		kind: 'app',
	},
	{
		id: 'stage',
		label: '/stage',
		description: 'Stage all changes (git add -A)',
		icon: GitBranch,
		kind: 'git',
	},
	{
		id: 'commit',
		label: '/commit',
		description: 'Commit staged changes',
		icon: Check,
		kind: 'git',
	},
	{
		id: 'compact',
		label: '/compact',
		description: 'Compact conversation to reduce context size',
		icon: Minimize2,
		kind: 'runtime',
	},
	{
		id: 'init',
		label: '/init',
		description:
			'Generate AGENTS.md and .agents docs from the real repo structure',
		icon: FileText,
		kind: 'runtime',
	},
	{
		id: 'handoff',
		label: '/handoff',
		description: 'Create a new session with current context',
		icon: ArrowRightLeft,
		kind: 'session',
	},
	{
		id: 'branch',
		label: '/branch',
		description: 'Branch session from last message',
		icon: Split,
		kind: 'session',
	},
	{
		id: 'delete',
		label: '/delete',
		description: 'Delete current session',
		icon: Trash2,
		kind: 'danger',
	},
	{
		id: 'share',
		label: '/share',
		description: 'Share session publicly',
		icon: Share2,
		kind: 'session',
	},
	{
		id: 'sync',
		label: '/sync',
		description: 'Sync new messages to shared session',
		icon: RefreshCw,
		kind: 'session',
	},
];

export function getCommandDescription(
	cmd: Command,
	state: CommandState,
): string {
	return typeof cmd.description === 'function'
		? cmd.description(state)
		: cmd.description;
}

export function findExactCommand(input: string): Command | undefined {
	const normalized = input.trim().toLowerCase();
	if (!normalized.startsWith('/')) return undefined;
	return COMMANDS.find(
		(cmd) =>
			cmd.label.toLowerCase() === normalized ||
			`/${cmd.id}`.toLowerCase() === normalized,
	);
}

export function shouldSendSlashCommandAsMessage(commandId: string): boolean {
	return commandId === 'compact' || commandId === 'init';
}

export function getCommandLabel(commandId: string): string | undefined {
	return COMMANDS.find((cmd) => cmd.id === commandId)?.label;
}

export function getCommandKind(commandId: string): CommandKind | undefined {
	return COMMANDS.find((cmd) => cmd.id === commandId)?.kind;
}

export function getRecipeCommandName(commandId: string): string | undefined {
	return commandId.startsWith('recipe:')
		? commandId.slice('recipe:'.length)
		: undefined;
}

export function parseSlashCommandName(input: string): string | undefined {
	const trimmed = input.trim();
	if (!trimmed.startsWith('/')) return undefined;
	const command = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase();
	return command || undefined;
}

export function getSlashCommandKind(
	input: string,
	recipeNames: string[] = [],
): CommandKind | undefined {
	const name = parseSlashCommandName(input);
	if (!name) return undefined;
	if (recipeNames.includes(name)) return 'recipe';
	return getCommandKind(name);
}

export function filterCommands(
	query: string,
	state: CommandState,
	extraCommands: Command[] = [],
): Command[] {
	const baseCommands = COMMANDS.filter((cmd) => {
		if (cmd.id === 'share' && state.isShared) return false;
		if (cmd.id === 'sync' && !state.isShared) return false;
		return true;
	});
	const commands = [...baseCommands, ...extraCommands];

	if (!query) {
		return commands;
	}

	const lowerQuery = query.toLowerCase();
	const matches: (Command & { matchScore: number })[] = [];

	for (const cmd of commands) {
		const desc = getCommandDescription(cmd, state);
		const labelMatch = cmd.label.toLowerCase().includes(lowerQuery);
		const descriptionMatch = desc.toLowerCase().includes(lowerQuery);

		if (labelMatch || descriptionMatch) {
			const matchScore = labelMatch ? 10 : 5;
			matches.push({ ...cmd, matchScore });
		}
	}

	return matches.sort((a, b) => {
		const scoreDiff = b.matchScore - a.matchScore;
		if (scoreDiff !== 0) return scoreDiff;
		return a.label.localeCompare(b.label);
	});
}
