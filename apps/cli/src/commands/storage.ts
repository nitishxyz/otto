import {
	formatStorageDoctor,
	formatStoragePlan,
	planStorageMigration,
} from '../storage.ts';

type StorageCommandOptions = {
	project?: string;
};

export async function runStorageDoctor(opts: StorageCommandOptions) {
	const plan = await planStorageMigration({ projectRoot: opts.project });
	console.log(formatStorageDoctor(plan));
}

export async function runStoragePlan(opts: StoragePlanOptions) {
	const plan = await planStorageMigration({
		projectRoot: opts.project,
		force: opts.force,
	});
	console.log(formatStoragePlan(plan));
}

type StoragePlanOptions = StorageCommandOptions & {
	force?: boolean;
};

export { registerStorageCommand } from './lazy/storage.ts';
