import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { loadConfig, logger, type OttoConfig } from '@ottocode/sdk';
import * as schema from './schema/index.ts';
import { bundledMigrations } from './runtime/migrations-bundled.ts';

const dbCache: Map<string, BunSQLiteDatabase<typeof schema>> = new Map();
const migratedPaths = new Set<string>();

export async function getDb(projectRootInput?: string) {
	const cfg = await loadConfig(projectRootInput);
	return getDbForConfig(cfg);
}

export async function getDbForConfig(cfg: OttoConfig) {
	// Data dir is ensured by loadConfig() already.
	return getDbByPath(cfg.paths.dbPath);
}

export async function getDbByPath(dbPath: string) {
	const key = dbPath;
	const cached = dbCache.get(key);
	if (cached) return cached;

	const sqlite = new Database(dbPath, { create: true });

	sqlite.exec('PRAGMA journal_mode = WAL');
	sqlite.exec('PRAGMA busy_timeout = 5000');
	sqlite.exec('PRAGMA synchronous = NORMAL');

	const db = drizzle(sqlite, { schema });

	// Run migrations once per db path (apply any not yet applied)
	if (!migratedPaths.has(dbPath)) {
		try {
			// Ensure migrations tracking table exists
			sqlite.exec(
				'CREATE TABLE IF NOT EXISTS otto_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
			);

			// Read applied migrations
			const appliedRows = sqlite
				.query('SELECT name FROM otto_migrations')
				.all() as Array<{ name: string }>;
			const applied = new Set(appliedRows.map((r) => r.name));

			for (const m of bundledMigrations) {
				if (applied.has(m.name)) continue;
				try {
					sqlite.exec('BEGIN TRANSACTION');
					sqlite.exec(m.content);
					sqlite.exec('COMMIT');
					sqlite
						.query(
							'INSERT INTO otto_migrations (name, applied_at) VALUES (?, ?)',
						)
						.run(m.name, Date.now());
				} catch (err) {
					// If migration fails due to already-applied schema (e.g., table exists / duplicate column), mark as applied and continue.
					sqlite.exec('ROLLBACK');
					const msg = String((err as Error)?.message ?? err);
					const benign =
						msg.includes('already exists') || msg.includes('duplicate column');
					if (benign) {
						sqlite
							.query(
								'INSERT OR IGNORE INTO otto_migrations (name, applied_at) VALUES (?, ?)',
							)
							.run(m.name, Date.now());
						continue;
					}
					throw err;
				}
			}
			migratedPaths.add(dbPath);
		} catch (error) {
			logger.error('Local database migration failed', error);
			throw error;
		}
	}
	dbCache.set(key, db);
	return db;
}

export type DB = Awaited<ReturnType<typeof getDb>>;
export * as dbSchema from './schema/index.ts';
