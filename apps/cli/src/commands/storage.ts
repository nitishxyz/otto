import type { Command } from 'commander';
import {
	formatStorageDoctor,
	formatStoragePlan,
	migrateStorage,
	planStorageMigration,
} from '../storage.ts';

type StorageCommandOptions = {
	project?: string;
};

type StorageMigrateOptions = StorageCommandOptions & {
	dryRun?: boolean;
	deleteLegacy?: boolean;
	force?: boolean;
};

export function registerStorageCommand(program: Command) {
	const storage = program
		.command('storage')
		.description('Inspect and migrate Otto project storage');

	storage
		.command('doctor')
		.description('Show project storage paths and migration status')
		.option('--project <path>', 'Use project at <path>')
		.action(async (opts: StorageCommandOptions) => {
			const plan = await planStorageMigration({ projectRoot: opts.project });
			console.log(formatStorageDoctor(plan));
		});

	storage
		.command('plan')
		.description(
			'Show the SQLite storage migration plan without touching files',
		)
		.option('--project <path>', 'Use project at <path>')
		.option('--force', 'Plan overwriting existing target SQLite files', false)
		.action(async (opts: StorageMigrateOptions) => {
			const plan = await planStorageMigration({
				projectRoot: opts.project,
				force: opts.force,
			});
			console.log(formatStoragePlan(plan));
		});

	storage
		.command('migrate')
		.description('Copy legacy SQLite files into project state storage')
		.option('--project <path>', 'Use project at <path>')
		.option(
			'--dry-run',
			'Show the migration plan without touching files',
			false,
		)
		.option(
			'--delete-legacy',
			'Delete legacy SQLite files after successful copy',
			false,
		)
		.option('--force', 'Overwrite existing target SQLite files', false)
		.action(async (opts: StorageMigrateOptions) => {
			const result = await migrateStorage({
				projectRoot: opts.project,
				dryRun: opts.dryRun,
				deleteLegacy: opts.deleteLegacy,
				force: opts.force,
			});
			console.log(formatStoragePlan(result));
		});
}
