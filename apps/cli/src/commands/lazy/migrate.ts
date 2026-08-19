import type { Command } from 'commander';

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
			const { migrateLooper } = await import('../migrate.ts');
			await migrateLooper(opts);
		});
}
