import type { Command } from 'commander';

export function registerProvidersCommand(program: Command) {
	const providers = program
		.command('providers')
		.alias('provider')
		.description('Manage built-in overrides and custom providers');

	providers
		.command('list')
		.alias('ls')
		.description('List configured providers')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--verbose', 'Show detailed provider metadata', false)
		.option('--models', 'Preview model ids instead of only counts', false)
		.action(async (opts) => {
			const { runProvidersList } = await import('../../providers.ts');
			await runProvidersList(opts.project, {
				verbose: opts.verbose,
				showModels: opts.models,
			});
		});

	providers
		.command('add')
		.description('Add a custom provider')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			const { runProvidersAdd } = await import('../../providers.ts');
			await runProvidersAdd(opts.project);
		});

	providers
		.command('remove <provider>')
		.alias('rm')
		.description('Remove a provider override or custom provider entry')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--scope <scope>', 'Config scope (local|global)')
		.action(async (provider, opts) => {
			const { runProvidersRemove } = await import('../../providers.ts');
			await runProvidersRemove(provider, opts.project, opts.scope);
		});
}
