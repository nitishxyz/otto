import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushFlag, pushOption } from './helpers.ts';

export function registerStorageCommand(program: Command) {
	const storage = program
		.command('storage')
		.description('Inspect and migrate Otto project storage');

	storage
		.command('doctor')
		.description('Show project storage paths and migration status')
		.option('--project <path>', 'Use project at <path>')
		.action(async (opts) => {
			const argv = ['storage', 'doctor'];
			pushOption(argv, '--project', opts.project);
			const { registerStorageCommand: register } = await import(
				'../storage.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});

	storage
		.command('plan')
		.description(
			'Show the SQLite storage migration plan without touching files',
		)
		.option('--project <path>', 'Use project at <path>')
		.option('--force', 'Plan overwriting existing target SQLite files', false)
		.action(async (opts) => {
			const argv = ['storage', 'plan'];
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--force', opts.force);
			const { registerStorageCommand: register } = await import(
				'../storage.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});
}
