import type { Command } from 'commander';
import {
	runProvidersAdd,
	runProvidersList,
	runProvidersRemove,
} from '../providers.ts';

/** Registers provider management subcommands on the root CLI program. */
export function registerProvidersCommand(program: Command) {
	const providers = program
		.command('providers')
		.alias('provider')
		.description('Manage built-in overrides and custom providers');

	// List shows configured providers and can optionally include model metadata.
	providers
		.command('list')
		.alias('ls')
		.description('List configured providers')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--verbose', 'Show detailed provider metadata', false)
		.option('--models', 'Preview model ids instead of only counts', false)
		.action(async (opts) => {
			await runProvidersList(opts.project, {
				verbose: opts.verbose,
				showModels: opts.models,
			});
		});

	// Add launches the interactive flow for creating a custom provider entry.
	providers
		.command('add')
		.description('Add a custom provider')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			await runProvidersAdd(opts.project);
		});

	// Remove accepts either custom providers or overrides by provider id.
	providers
		.command('remove <provider>')
		.alias('rm')
		.description('Remove a provider override or custom provider entry')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--scope <scope>', 'Config scope (local|global)')
		.action(async (provider, opts) => {
			await runProvidersRemove(provider, opts.project, opts.scope);
		});
}
