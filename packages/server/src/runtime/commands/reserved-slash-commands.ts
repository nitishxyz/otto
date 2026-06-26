/** Slash command names that cannot be used as recipe names. */
export const RESERVED_RECIPE_SLASH_COMMAND_NAMES = [
	'compact',
	'init',
	'models',
	'agents',
	'new',
	'stop',
	'help',
	'follow',
	'vim',
	'reasoning',
	'stage',
	'commit',
	'handoff',
	'branch',
	'delete',
	'share',
	'sync',
	'plugin',
] as const;

const RESERVED_RECIPE_SLASH_COMMAND_NAME_SET = new Set<string>(
	RESERVED_RECIPE_SLASH_COMMAND_NAMES,
);

export function isReservedRecipeSlashCommandName(name: string): boolean {
	return RESERVED_RECIPE_SLASH_COMMAND_NAME_SET.has(name.toLowerCase());
}
