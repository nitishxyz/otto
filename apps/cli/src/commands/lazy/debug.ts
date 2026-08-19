import type { Command } from 'commander';

export function registerDebugCommand(program: Command) {
	const debug = program
		.command('debug')
		.description('Manage shared debug logging');

	debug
		.command('on [scopes...]')
		.description('Enable debug logging globally, optionally limited to scopes')
		.action(async (scopes: string[] = []) => {
			const { enableDebug } = await import('../debug.ts');
			await enableDebug(scopes);
		});

	debug
		.command('off')
		.description('Disable debug logging globally')
		.action(async () => {
			const { disableDebug } = await import('../debug.ts');
			await disableDebug();
		});

	debug
		.command('status')
		.description('Show current debug logging status')
		.action(async () => {
			const { showDebugStatus } = await import('../debug.ts');
			await showDebugStatus();
		});

	debug
		.command('path')
		.description('Print the main debug log path')
		.action(async () => {
			const { printDebugPath } = await import('../debug.ts');
			printDebugPath();
		});
}
