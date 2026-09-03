import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	backfillCacheUsageDatabase,
	CACHE_USAGE_BACKFILL_MARKER,
	CACHE_USAGE_ENABLED_MARKER,
} from '../apps/cli/src/cache-usage-backfill.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function createFixtureDatabase(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'otto-cache-usage-'));
	temporaryDirectories.push(directory);
	const dbPath = join(directory, 'otto.sqlite');
	const db = new Database(dbPath);
	db.exec(`
		CREATE TABLE otto_migrations (
			name TEXT PRIMARY KEY,
			applied_at INTEGER NOT NULL
		);
		CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			total_input_tokens INTEGER,
			total_output_tokens INTEGER,
			total_cached_tokens INTEGER,
			total_cache_creation_tokens INTEGER,
			total_reasoning_tokens INTEGER
		);
		CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			role TEXT NOT NULL,
			provider TEXT NOT NULL,
			model TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			prompt_tokens INTEGER,
			completion_tokens INTEGER,
			total_tokens INTEGER,
			cached_input_tokens INTEGER,
			cache_creation_input_tokens INTEGER,
			reasoning_tokens INTEGER
		);
		INSERT INTO sessions VALUES ('session-1', 99999, 99999, 99999, 99999, 99999);
		INSERT INTO messages VALUES
			('xai-legacy', 'session-1', 'assistant', 'xai', 'grok-4.6', 1000, 10000, 100, 18100, 8000, 0, 0),
			('openai-split', 'session-1', 'assistant', 'openai', 'gpt-5.6-sol', 1000, 2000, 50, 10050, 8000, 0, 0),
			('opencode-openai-split', 'session-1', 'assistant', 'opencode', 'gpt-5.6-sol', 1000, 1500, 25, 9025, 7500, 0, 0),
			('xai-new', 'session-1', 'assistant', 'xai', 'grok-4.6', 3000, 1000, 10, 9010, 8000, 0, 0);
		INSERT INTO otto_migrations VALUES ('${CACHE_USAGE_ENABLED_MARKER}', 2000);
	`);
	db.close();
	return dbPath;
}

describe('cache usage backfill', () => {
	test('repairs legacy providers, recomputes sessions, and is idempotent', async () => {
		const dbPath = await createFixtureDatabase();
		const result = await backfillCacheUsageDatabase(dbPath, {
			createBackup: false,
			now: 4000,
		});

		expect(result).toEqual({
			status: 'migrated',
			messages: 1,
			sessions: 1,
			inputTokensRemoved: 8000,
			backupPath: undefined,
		});

		const db = new Database(dbPath, { readonly: true });
		const messages = db
			.query(
				'SELECT id, prompt_tokens AS input, total_tokens AS total FROM messages ORDER BY id',
			)
			.all() as Array<{ id: string; input: number; total: number }>;
		expect(messages).toEqual([
			{ id: 'openai-split', input: 2000, total: 10050 },
			{ id: 'opencode-openai-split', input: 1500, total: 9025 },
			{ id: 'xai-legacy', input: 2000, total: 10100 },
			{ id: 'xai-new', input: 1000, total: 9010 },
		]);
		const session = db
			.query(`SELECT
				total_input_tokens AS input,
				total_output_tokens AS output,
				total_cached_tokens AS cached,
				total_cache_creation_tokens AS cacheCreation,
				total_reasoning_tokens AS reasoning
			FROM sessions WHERE id = 'session-1'`)
			.get();
		expect(session).toEqual({
			input: 6500,
			output: 185,
			cached: 31500,
			cacheCreation: 0,
			reasoning: 0,
		});
		expect(
			db
				.query('SELECT 1 FROM otto_migrations WHERE name = ?')
				.get(CACHE_USAGE_BACKFILL_MARKER),
		).not.toBeNull();
		db.close();

		expect(
			await backfillCacheUsageDatabase(dbPath, {
				createBackup: false,
				now: 5000,
			}),
		).toEqual({
			status: 'already-applied',
			messages: 0,
			sessions: 0,
			inputTokensRemoved: 0,
		});
	});

	test('dry run reports repairs without writing markers or rows', async () => {
		const dbPath = await createFixtureDatabase();
		expect(
			await backfillCacheUsageDatabase(dbPath, {
				dryRun: true,
				now: 4000,
			}),
		).toEqual({
			status: 'would-migrate',
			messages: 1,
			sessions: 1,
			inputTokensRemoved: 8000,
		});

		const db = new Database(dbPath, { readonly: true });
		expect(
			db
				.query("SELECT prompt_tokens FROM messages WHERE id = 'xai-legacy'")
				.get(),
		).toEqual({ prompt_tokens: 10000 });
		expect(
			db
				.query('SELECT 1 FROM otto_migrations WHERE name = ?')
				.get(CACHE_USAGE_BACKFILL_MARKER),
		).toBeNull();
		db.close();
	});
});
