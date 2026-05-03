import type { Command } from 'commander';
import {
	dispatchRegisteredCommand,
	pushFlag,
	pushOption,
	pushVariadicOption,
} from './helpers.ts';

export function registerMCPCommand(program: Command) {
	const mcp = program
		.command('mcp')
		.description('Manage MCP (Model Context Protocol) servers');

	mcp
		.command('list', { isDefault: true })
		.description('List configured MCP servers')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async () => {
			const { registerMCPCommand: register } = await import('../mcp.ts');
			await dispatchRegisteredCommand(register, ['mcp', 'list']);
		});

	mcp
		.command('status')
		.description('Show running MCP servers and their tools')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async () => {
			const { registerMCPCommand: register } = await import('../mcp.ts');
			await dispatchRegisteredCommand(register, ['mcp', 'status']);
		});

	mcp
		.command('test <name>')
		.description('Test connection to an MCP server')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (name) => {
			const { registerMCPCommand: register } = await import('../mcp.ts');
			await dispatchRegisteredCommand(register, ['mcp', 'test', name]);
		});

	mcp
		.command('add <name>')
		.description('Add an MCP server to project config')
		.option('--command <cmd>', 'Command to run (for stdio)')
		.option('--args <args...>', 'Command arguments')
		.option('--transport <type>', 'Transport type: stdio, http, sse', 'stdio')
		.option('--url <url>', 'Server URL (for http/sse)')
		.option('--header <headers...>', 'Headers (Key: Value)')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--global', 'Add to global config instead of project', false)
		.action(async (name, opts) => {
			const argv = ['mcp', 'add', name];
			pushOption(argv, '--command', opts.command);
			pushVariadicOption(argv, '--args', opts.args);
			pushOption(argv, '--transport', opts.transport);
			pushOption(argv, '--url', opts.url);
			pushVariadicOption(argv, '--header', opts.header);
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--global', opts.global);
			const { registerMCPCommand: register } = await import('../mcp.ts');
			await dispatchRegisteredCommand(register, argv);
		});

	mcp
		.command('remove <name>')
		.description('Remove an MCP server from config')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--global', 'Remove from global config', false)
		.action(async (name, opts) => {
			const argv = ['mcp', 'remove', name];
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--global', opts.global);
			const { registerMCPCommand: register } = await import('../mcp.ts');
			await dispatchRegisteredCommand(register, argv);
		});

	mcp
		.command('auth <name>')
		.description('Authenticate with an OAuth MCP server')
		.option('--revoke', 'Revoke stored credentials', false)
		.option('--status', 'Show auth status', false)
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (name, opts) => {
			const argv = ['mcp', 'auth', name];
			pushFlag(argv, '--revoke', opts.revoke);
			pushFlag(argv, '--status', opts.status);
			pushOption(argv, '--project', opts.project);
			const { registerMCPCommand: register } = await import('../mcp.ts');
			await dispatchRegisteredCommand(register, argv);
		});
}
