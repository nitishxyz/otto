import { Database } from 'bun:sqlite';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getDb } from '@ottocode/database';
import { getProjectsStateRoot, loadConfig } from '@ottocode/sdk';

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
