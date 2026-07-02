import type { Command } from 'commander';
import {
	formatStorageDoctor,
	formatStoragePlan,
	planStorageMigration,
} from '../storage.ts';

type StorageCommandOptions = {
	project?: string;
};

type StoragePlanOptions = StorageCommandOptions & {
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
		.action(async (opts: StoragePlanOptions) => {
			const plan = await planStorageMigration({
				projectRoot: opts.project,
				force: opts.force,
			});
			console.log(formatStoragePlan(plan));
		});
}
