import type { Command } from 'commander';

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
			const { runAuth } = await import('../../auth.ts');
			const args = provider ? [provider] : [];
			if (opts.local) args.push('--local');
			if (opts.method) args.push('--method', opts.method);
			await runAuth(['login', ...args]);
		});

	auth
		.command('status [provider]')
		.description('Show detailed auth diagnostics (copilot supported)')
		.action(async (provider) => {
			const { runAuthStatus } = await import('../../auth.ts');
			await runAuthStatus(provider ? [provider] : []);
		});

	auth
		.command('list')
		.alias('ls')
		.description('List stored credentials')
		.action(async () => {
			const { runAuthList } = await import('../../auth.ts');
			await runAuthList([]);
		});

	auth
		.command('logout')
		.alias('rm')
		.alias('remove')
		.description('Remove stored credentials')
		.option('--local', 'Remove from local storage', false)
		.action(async (opts) => {
			const { runAuthLogout } = await import('../../auth.ts');
			await runAuthLogout(opts.local ? ['--local'] : []);
		});

	program
		.command('setup')
		.description('Alias for `auth login`')
		.action(async () => {
			const { runAuth } = await import('../../auth.ts');
			await runAuth(['login']);
		});
}
