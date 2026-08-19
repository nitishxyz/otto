import type { Command } from 'commander';

export function registerMCPCommand(program: Command) {
	const mcp = program
		.command('mcp')
		.description('Manage MCP (Model Context Protocol) servers');

	mcp
		.command('list', { isDefault: true })
		.description('List configured MCP servers')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			const { runMCPList } = await import('../mcp.ts');
			await runMCPList(opts.project);
		});

	mcp
		.command('status')
		.description('Show running MCP servers and their tools')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			const { runMCPStatus } = await import('../mcp.ts');
			await runMCPStatus(opts.project);
		});

	mcp
		.command('test <name>')
		.description('Test connection to an MCP server')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (name, opts) => {
			const { runMCPTest } = await import('../mcp.ts');
			await runMCPTest(name, opts.project);
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
			const { runMCPAdd } = await import('../mcp.ts');
			await runMCPAdd(name, {
				transport: opts.transport,
				command: opts.command,
				args: opts.args,
				url: opts.url,
				headers: opts.header,
				global: opts.global,
			});
		});

	mcp
		.command('remove <name>')
		.description('Remove an MCP server from config')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--global', 'Remove from global config', false)
		.action(async (name, opts) => {
			const { runMCPRemove } = await import('../mcp.ts');
			await runMCPRemove(name, opts.project, opts.global);
		});

	mcp
		.command('auth <name>')
		.description('Authenticate with an OAuth MCP server')
		.option('--revoke', 'Revoke stored credentials', false)
		.option('--status', 'Show auth status', false)
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (name, opts) => {
			const { runMCPAuth } = await import('../mcp.ts');
			await runMCPAuth(name, opts);
		});
}
