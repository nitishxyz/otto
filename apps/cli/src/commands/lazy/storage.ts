import type { Command } from 'commander';

export function registerStorageCommand(program: Command) {
	const storage = program
		.command('storage')
		.description('Inspect and migrate Otto project storage');

	storage
		.command('doctor')
		.description('Show project storage paths and migration status')
		.option('--project <path>', 'Use project at <path>')
		.action(async (opts) => {
			const { runStorageDoctor } = await import('../storage.ts');
			await runStorageDoctor(opts);
		});

	storage
		.command('plan')
		.description(
			'Show the SQLite storage migration plan without touching files',
		)
		.option('--project <path>', 'Use project at <path>')
		.option('--force', 'Plan overwriting existing target SQLite files', false)
		.action(async (opts) => {
			const { runStoragePlan } = await import('../storage.ts');
			await runStoragePlan(opts);
		});
}
