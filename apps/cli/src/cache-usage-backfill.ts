import { Database } from 'bun:sqlite';
import { mkdir, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
	CACHE_USAGE_NORMALIZATION_MARKER,
	getProjectsStateRoot,
	resolveUsageProvider,
	type ProviderId,
} from '@ottocode/sdk';

export const CACHE_USAGE_ENABLED_MARKER = CACHE_USAGE_NORMALIZATION_MARKER;
export const CACHE_USAGE_BACKFILL_MARKER =
	'cache_usage_normalization_v2_backfill';

type CacheUsageRow = {
	id: string;
	sessionId: string;
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	cacheCreationInputTokens: number;
	reasoningTokens: number;
};

export type CacheUsageBackfillResult = {
	status: 'migrated' | 'would-migrate' | 'already-applied' | 'no-changes';
	messages: number;
	sessions: number;
	inputTokensRemoved: number;
	backupPath?: string;
};

type CacheUsageBackfillOptions = {
	dryRun?: boolean;
	createBackup?: boolean;
	backupRoot?: string;
	now?: number;
};

function quoteSqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function getMarker(db: Database, name: string): number | undefined {
	const row = db
		.query('SELECT applied_at AS appliedAt FROM otto_migrations WHERE name = ?')
		.get(name) as { appliedAt: number } | null;
	return row ? Number(row.appliedAt) : undefined;
}

function getRepairableRows(db: Database, before: number): CacheUsageRow[] {
	const rows = db
		.query(
			`SELECT id,
				session_id AS sessionId,
				provider,
				model,
				COALESCE(prompt_tokens, 0) AS inputTokens,
				COALESCE(completion_tokens, 0) AS outputTokens,
				COALESCE(cached_input_tokens, 0) AS cachedInputTokens,
				COALESCE(cache_creation_input_tokens, 0) AS cacheCreationInputTokens,
				COALESCE(reasoning_tokens, 0) AS reasoningTokens
			FROM messages
			WHERE created_at < ?
				AND (COALESCE(cached_input_tokens, 0) > 0
					OR COALESCE(cache_creation_input_tokens, 0) > 0)`,
		)
		.all(before) as CacheUsageRow[];

	return rows.filter((row) => {
		const usageProvider = resolveUsageProvider(
			row.provider as ProviderId,
			row.model,
		);
		if (usageProvider === 'openai' || usageProvider === 'anthropic') {
			return false;
		}
		const includedCacheTokens =
			row.cachedInputTokens + row.cacheCreationInputTokens;
		return includedCacheTokens > 0 && row.inputTokens >= includedCacheTokens;
	});
}

async function createDatabaseBackup(
	db: Database,
	dbPath: string,
	backupRoot: string,
	now: number,
): Promise<string> {
	await mkdir(backupRoot, { recursive: true });
	const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
	const project = basename(dirname(dbPath));
	let backupPath = join(backupRoot, `${project}-cache-usage-${stamp}.sqlite`);
	let index = 2;
	while (await Bun.file(backupPath).exists()) {
		backupPath = join(
			backupRoot,
			`${project}-cache-usage-${stamp}-${index}.sqlite`,
		);
		index++;
	}
	db.exec(`VACUUM INTO ${quoteSqlString(backupPath)}`);
	return backupPath;
}

function recalculateSessionTotals(db: Database, sessionIds: Set<string>): void {
	const update = db.query(`UPDATE sessions
		SET total_input_tokens = COALESCE((
				SELECT SUM(COALESCE(prompt_tokens, 0)) FROM messages
				WHERE session_id = ? AND role = 'assistant'
			), 0),
			total_output_tokens = COALESCE((
				SELECT SUM(COALESCE(completion_tokens, 0)) FROM messages
				WHERE session_id = ? AND role = 'assistant'
			), 0),
			total_cached_tokens = COALESCE((
				SELECT SUM(COALESCE(cached_input_tokens, 0)) FROM messages
				WHERE session_id = ? AND role = 'assistant'
			), 0),
			total_cache_creation_tokens = COALESCE((
				SELECT SUM(COALESCE(cache_creation_input_tokens, 0)) FROM messages
				WHERE session_id = ? AND role = 'assistant'
			), 0),
			total_reasoning_tokens = COALESCE((
				SELECT SUM(COALESCE(reasoning_tokens, 0)) FROM messages
				WHERE session_id = ? AND role = 'assistant'
			), 0)
		WHERE id = ?`);
	for (const sessionId of sessionIds) {
		update.run(
			sessionId,
			sessionId,
			sessionId,
			sessionId,
			sessionId,
			sessionId,
		);
	}
}

/** Repairs cache token splits written before cross-provider normalization. */
export async function backfillCacheUsageDatabase(
	dbPath: string,
	options: CacheUsageBackfillOptions = {},
): Promise<CacheUsageBackfillResult> {
	const now = options.now ?? Date.now();
	const db = new Database(dbPath);
	try {
		db.exec('PRAGMA busy_timeout = 5000');
		db.exec(
			'CREATE TABLE IF NOT EXISTS otto_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
		);
		if (getMarker(db, CACHE_USAGE_BACKFILL_MARKER) != null) {
			return {
				status: 'already-applied',
				messages: 0,
				sessions: 0,
				inputTokensRemoved: 0,
			};
		}

		const enabledAt = getMarker(db, CACHE_USAGE_ENABLED_MARKER) ?? now;
		const rows = getRepairableRows(db, enabledAt);
		const sessionIds = new Set(rows.map((row) => row.sessionId));
		const inputTokensRemoved = rows.reduce(
			(total, row) =>
				total + row.cachedInputTokens + row.cacheCreationInputTokens,
			0,
		);
		if (options.dryRun) {
			return {
				status: rows.length > 0 ? 'would-migrate' : 'no-changes',
				messages: rows.length,
				sessions: sessionIds.size,
				inputTokensRemoved,
			};
		}

		let backupPath: string | undefined;
		if (rows.length > 0 && options.createBackup !== false) {
			const backupRoot =
				options.backupRoot ?? join(getProjectsStateRoot(), '..', 'backups');
			backupPath = await createDatabaseBackup(db, dbPath, backupRoot, now);
		}

		db.exec('BEGIN IMMEDIATE');
		try {
			db.query(
				'INSERT OR IGNORE INTO otto_migrations (name, applied_at) VALUES (?, ?)',
			).run(CACHE_USAGE_ENABLED_MARKER, enabledAt);
			const updateMessage = db.query(`UPDATE messages
				SET prompt_tokens = ?, total_tokens = ?
				WHERE id = ?`);
			for (const row of rows) {
				const inputTokens =
					row.inputTokens -
					row.cachedInputTokens -
					row.cacheCreationInputTokens;
				const totalTokens =
					inputTokens +
					row.outputTokens +
					row.cachedInputTokens +
					row.cacheCreationInputTokens +
					row.reasoningTokens;
				updateMessage.run(inputTokens, totalTokens, row.id);
			}
			recalculateSessionTotals(db, sessionIds);
			db.query(
				'INSERT INTO otto_migrations (name, applied_at) VALUES (?, ?)',
			).run(CACHE_USAGE_BACKFILL_MARKER, now);
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}

		return {
			status: rows.length > 0 ? 'migrated' : 'no-changes',
			messages: rows.length,
			sessions: sessionIds.size,
			inputTokensRemoved,
			backupPath,
		};
	} finally {
		db.close();
	}
}

export async function findProjectDatabasePaths(): Promise<string[]> {
	const projectsRoot = getProjectsStateRoot();
	let entries: Dirent[];
	try {
		entries = await readdir(projectsRoot, { withFileTypes: true });
	} catch {
		return [];
	}
	const paths: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const dbPath = join(projectsRoot, entry.name, 'otto.sqlite');
		if (await Bun.file(dbPath).exists()) paths.push(dbPath);
	}
	return paths.sort();
}
