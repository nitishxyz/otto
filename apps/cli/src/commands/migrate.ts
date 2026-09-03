import { Database } from 'bun:sqlite';
import { readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { getDb } from '@ottocode/database';
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

function migrateLooperDb(dbPath: string): {
	agent: number;
	sessionType: number;
} {
	const db = new Database(dbPath);
	try {
		db.exec('PRAGMA busy_timeout = 5000');
		const agentResult = db
			.query("UPDATE sessions SET agent = 'looper' WHERE agent = 'otto'")
			.run();
		const typeResult = db
			.query(
				"UPDATE sessions SET session_type = 'looper' WHERE session_type = 'otto'",
			)
			.run();
		return { agent: agentResult.changes, sessionType: typeResult.changes };
	} finally {
		db.close();
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

export async function migrateLooper(opts: { project?: string; all?: boolean }) {
	if (opts.all) {
		const projectsRoot = getProjectsStateRoot();
		let entries: Array<{ name: string; isDirectory(): boolean }> = [];
		try {
			entries = await readdir(projectsRoot, { withFileTypes: true });
		} catch {
			console.log(`No project state found at ${projectsRoot}`);
			return;
		}
		let migrated = 0;
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const dbPath = join(projectsRoot, entry.name, 'otto.sqlite');
			if (!(await Bun.file(dbPath).exists())) continue;
			try {
				const result = migrateLooperDb(dbPath);
				migrated++;
				console.log(
					`${entry.name}: agent ${result.agent}, session_type ${result.sessionType}`,
				);
			} catch (error) {
				console.error(
					`${entry.name}: failed (${error instanceof Error ? error.message : error})`,
				);
			}
		}
		console.log(`Migrated ${migrated} project database(s).`);
		return;
	}

	const cfg = await loadConfig(
		opts.project ? resolve(opts.project) : undefined,
	);
	await getDb(cfg.projectRoot);
	const result = migrateLooperDb(cfg.paths.dbPath);
	console.log(`Database: ${cfg.paths.dbPath}`);
	console.log(`Sessions agent otto -> looper: ${result.agent}`);
	console.log(`Sessions session_type otto -> looper: ${result.sessionType}`);
}

export { registerMigrateCommand } from './lazy/migrate.ts';
