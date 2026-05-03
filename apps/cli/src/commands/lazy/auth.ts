import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushFlag, pushOption } from './helpers.ts';

export function registerAuthCommand(program: Command) {
	const auth = program
		.command('auth')
		.description('Manage provider credentials');

	auth
		.command('login [provider]')
		.description('Add or update provider credentials')
		.option('--local', 'Store credentials locally (deprecated)', false)
		.option('--method <method>', 'Auth method (copilot: oauth|token|gh)')
		.action(async (provider, opts) => {
			const argv = ['auth', 'login'];
			if (provider) argv.push(provider);
			pushFlag(argv, '--local', opts.local);
			pushOption(argv, '--method', opts.method);
			const { registerAuthCommand: register } = await import('../auth.ts');
			await dispatchRegisteredCommand(register, argv);
		});

	auth
		.command('status [provider]')
		.description('Show detailed auth diagnostics (copilot supported)')
		.action(async (provider) => {
			const argv = ['auth', 'status'];
			if (provider) argv.push(provider);
			const { registerAuthCommand: register } = await import('../auth.ts');
			await dispatchRegisteredCommand(register, argv);
		});

	auth
		.command('list')
		.alias('ls')
		.description('List stored credentials')
		.action(async () => {
			const { registerAuthCommand: register } = await import('../auth.ts');
			await dispatchRegisteredCommand(register, ['auth', 'list']);
		});

	auth
		.command('logout')
		.alias('rm')
		.alias('remove')
		.description('Remove stored credentials')
		.option('--local', 'Remove from local storage', false)
		.action(async (opts) => {
			const argv = ['auth', 'logout'];
			pushFlag(argv, '--local', opts.local);
			const { registerAuthCommand: register } = await import('../auth.ts');
			await dispatchRegisteredCommand(register, argv);
		});

	program
		.command('setup')
		.description('Alias for `auth login`')
		.action(async () => {
			const { registerAuthCommand: register } = await import('../auth.ts');
			await dispatchRegisteredCommand(register, ['setup']);
		});
}
