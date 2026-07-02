import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushFlag, pushOption } from './helpers.ts';

export function registerMigrateCommand(program: Command) {
	const migrate = program
		.command('migrate')
		.description('Run one-off otto data migrations');

	migrate
		.command('looper')
		.description(
			"Rename legacy 'otto' orchestrator sessions to 'looper' in project databases",
		)
		.option('--project <path>', 'Only migrate the project at <path>')
		.option('--all', 'Migrate every project database in otto state storage')
		.action(async (opts) => {
			const argv = ['migrate', 'looper'];
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--all', opts.all);
			const { registerMigrateCommand: register } = await import(
				'../migrate.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});
}
