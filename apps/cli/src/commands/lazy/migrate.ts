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

	migrate
		.command('cache-usage')
		.description(
			'Repair legacy cross-provider cache token totals in project databases',
		)
		.option('--project <path>', 'Only migrate the project at <path>')
		.option('--all', 'Migrate every project database in otto state storage')
		.option(
			'--dry-run',
			'Report repairs without changing or backing up databases',
		)
		.option('--no-backup', 'Skip the default SQLite backup before each repair')
		.action(async (opts) => {
			const { migrateCacheUsage } = await import('../migrate.ts');
			await migrateCacheUsage(opts);
		});
}
