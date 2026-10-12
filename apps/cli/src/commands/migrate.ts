import { basename, dirname, resolve } from 'node:path';
import { getProjectsStateRoot, loadConfig } from '@ottocode/sdk';
import {
	backfillCacheUsageDatabase,
	findProjectDatabasePaths,
} from '../cache-usage-backfill.ts';
import { readDaemonRegistration } from '../daemon.ts';

function isProcessAlive(pid: number): boolean {
	try {
		return process.kill(pid, 0);
	} catch (error) {
		return !(
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ESRCH'
		);
	}
}

export async function migrateCacheUsage(opts: {
	project?: string;
	all?: boolean;
	dryRun?: boolean;
	backup?: boolean;
}) {
	if (!opts.dryRun) {
		const registration = await readDaemonRegistration();
		if (registration && isProcessAlive(registration.pid)) {
			throw new Error(
				'Stop the Otto daemon before repairing cache usage: otto service stop',
			);
		}
	}
	const dbPaths = opts.all
		? await findProjectDatabasePaths()
		: [
				(await loadConfig(opts.project ? resolve(opts.project) : undefined))
					.paths.dbPath,
			];
	if (dbPaths.length === 0) {
		console.log(`No project databases found at ${getProjectsStateRoot()}`);
		return;
	}

	let migratedDatabases = 0;
	let migratedMessages = 0;
	let migratedSessions = 0;
	let alreadyApplied = 0;
	let noChanges = 0;
	let failed = 0;
	for (const dbPath of dbPaths) {
		try {
			const result = await backfillCacheUsageDatabase(dbPath, {
				dryRun: opts.dryRun,
				createBackup: opts.backup !== false,
			});
			if (result.status === 'migrated' || result.status === 'would-migrate') {
				migratedDatabases++;
			}
			if (result.status === 'already-applied') alreadyApplied++;
			if (result.status === 'no-changes') noChanges++;
			migratedMessages += result.messages;
			migratedSessions += result.sessions;
			const label = opts.all ? basename(dirname(dbPath)) : dbPath;
			if (!opts.all || result.messages > 0) {
				console.log(
					`${label}: ${result.status}, messages ${result.messages}, sessions ${result.sessions}, input tokens corrected ${result.inputTokensRemoved}`,
				);
			}
			if (result.backupPath) console.log(`  backup: ${result.backupPath}`);
		} catch (error) {
			failed++;
			console.error(
				`${dbPath}: failed (${error instanceof Error ? error.message : error})`,
			);
		}
	}
	console.log(
		`${opts.dryRun ? 'Would migrate' : 'Migrated'} ${migratedDatabases} of ${dbPaths.length} database(s): ${migratedMessages} message(s), ${migratedSessions} session(s), ${noChanges} unchanged, ${alreadyApplied} already applied, ${failed} failed.`,
	);
}

export { registerMigrateCommand } from './lazy/migrate.ts';
