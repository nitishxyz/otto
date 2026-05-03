import type { Command } from 'commander';
import { dispatchRegisteredCommand } from './helpers.ts';

export function registerDebugCommand(program: Command) {
	const debug = program
		.command('debug')
		.description('Manage shared debug logging');

	debug
		.command('on [scopes...]')
		.description('Enable debug logging globally, optionally limited to scopes')
		.action(async (scopes: string[] = []) => {
			const { registerDebugCommand: register } = await import('../debug.ts');
			await dispatchRegisteredCommand(register, ['debug', 'on', ...scopes]);
		});

	debug
		.command('off')
		.description('Disable debug logging globally')
		.action(async () => {
			const { registerDebugCommand: register } = await import('../debug.ts');
			await dispatchRegisteredCommand(register, ['debug', 'off']);
		});

	debug
		.command('status')
		.description('Show current debug logging status')
		.action(async () => {
			const { registerDebugCommand: register } = await import('../debug.ts');
			await dispatchRegisteredCommand(register, ['debug', 'status']);
		});

	debug
		.command('path')
		.description('Print the main debug log path')
		.action(async () => {
			const { registerDebugCommand: register } = await import('../debug.ts');
			await dispatchRegisteredCommand(register, ['debug', 'path']);
		});
}
