import { COMMANDS } from './commands';

export const RESERVED_RECIPE_COMMAND_NAMES = new Set(
	COMMANDS.map((command) => command.id),
);

export function isReservedRecipeCommandName(name: string): boolean {
	return RESERVED_RECIPE_COMMAND_NAMES.has(name.toLowerCase());
}
