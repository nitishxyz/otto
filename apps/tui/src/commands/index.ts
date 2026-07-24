export {
	COMMANDS,
	COMMAND_ALIASES,
	parseCommand,
	resolveCommand,
	type ParsedCommand,
} from './registry.ts';
export { executeCommand, type CommandContext } from './dispatcher.ts';
