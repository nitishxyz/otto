import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushFlag, pushOption } from './helpers.ts';

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
			const argv = ['providers', 'list'];
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--verbose', opts.verbose);
			pushFlag(argv, '--models', opts.models);
			const { registerProvidersCommand: register } = await import(
				'../providers.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});

	providers
		.command('add')
		.description('Add a custom provider')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			const argv = ['providers', 'add'];
			pushOption(argv, '--project', opts.project);
			const { registerProvidersCommand: register } = await import(
				'../providers.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});

	providers
		.command('remove <provider>')
		.alias('rm')
		.description('Remove a provider override or custom provider entry')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--scope <scope>', 'Config scope (local|global)')
		.action(async (provider, opts) => {
			const argv = ['providers', 'remove', provider];
			pushOption(argv, '--project', opts.project);
			pushOption(argv, '--scope', opts.scope);
			const { registerProvidersCommand: register } = await import(
				'../providers.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});
}
