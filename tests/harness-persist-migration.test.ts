import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { bundledMigrations } from '../packages/database/src/runtime/migrations-bundled.ts';

const FIRST_NEW_MIGRATION = '0011_dedupe_message_part_index.sql';

function applyMigrations(
	sqlite: Database,
	migrations: typeof bundledMigrations,
) {
	for (const migration of migrations) {
		sqlite.exec('BEGIN TRANSACTION');
		sqlite.exec(migration.content);
		sqlite.exec('COMMIT');
	}
}

function splitMigrations() {
	const index = bundledMigrations.findIndex(
		(migration) => migration.name === FIRST_NEW_MIGRATION,
	);
	expect(index).toBeGreaterThan(0);
	return {
		before: bundledMigrations.slice(0, index),
		after: bundledMigrations.slice(index),
	};
}

function insertSession(sqlite: Database, id: string) {
	sqlite
		.query(
			`INSERT INTO sessions (id, agent, provider, model, project_path, created_at)
			 VALUES (?, 'build', 'openai', 'gpt', '/tmp/project', 0)`,
		)
		.run(id);
}

function insertMessage(
	sqlite: Database,
	id: string,
	sessionId: string,
	createdAt: number,
) {
	sqlite
		.query(
			`INSERT INTO messages (id, session_id, role, status, agent, provider, model, created_at)
			 VALUES (?, ?, 'user', 'complete', 'build', 'openai', 'gpt', ?)`,
		)
		.run(id, sessionId, createdAt);
}

function insertPart(
	sqlite: Database,
	id: string,
	messageId: string,
	index: number,
	startedAt: number,
) {
	sqlite
		.query(
			`INSERT INTO message_parts (id, message_id, "index", type, content, agent, provider, model, started_at)
			 VALUES (?, ?, ?, 'text', '{}', 'build', 'openai', 'gpt', ?)`,
		)
		.run(id, messageId, index, startedAt);
}

describe('message ordering migration', () => {
	test('backfills sequence, dedupes part indexes, and assigns sequence on insert', () => {
		const sqlite = new Database(':memory:');
		const { before, after } = splitMigrations();
		applyMigrations(sqlite, before);

		insertSession(sqlite, 's1');
		insertSession(sqlite, 's2');
		// Same-millisecond messages keep insertion order.
		insertMessage(sqlite, 'm1', 's1', 100);
		insertMessage(sqlite, 'm2', 's1', 100);
		insertMessage(sqlite, 'm3', 's1', 50);
		insertMessage(sqlite, 'n1', 's2', 10);
		insertPart(sqlite, 'p-a', 'm1', 0, 1);
		insertPart(sqlite, 'p-b', 'm1', 0, 2);
		insertPart(sqlite, 'p-c', 'm1', 1, 3);
		insertPart(sqlite, 'q-a', 'm2', 3, 1);
		insertPart(sqlite, 'q-b', 'm2', 7, 2);

		applyMigrations(sqlite, after);

		const sequences = sqlite
			.query('SELECT id, sequence FROM messages ORDER BY id')
			.all() as Array<{ id: string; sequence: number }>;
		expect(
			Object.fromEntries(sequences.map((r) => [r.id, r.sequence])),
		).toEqual({ m1: 2, m2: 3, m3: 1, n1: 1 });

		const parts = sqlite
			.query('SELECT id, "index" FROM message_parts ORDER BY id')
			.all() as Array<{ id: string; index: number }>;
		expect(Object.fromEntries(parts.map((r) => [r.id, r.index]))).toEqual({
			'p-a': 0,
			'p-b': 1,
			'p-c': 2,
			'q-a': 3,
			'q-b': 7,
		});

		insertMessage(sqlite, 'm4', 's1', 1);
		insertMessage(sqlite, 'n2', 's2', 1);
		const inserted = sqlite
			.query("SELECT id, sequence FROM messages WHERE id IN ('m4', 'n2')")
			.all() as Array<{ id: string; sequence: number }>;
		expect(Object.fromEntries(inserted.map((r) => [r.id, r.sequence]))).toEqual(
			{ m4: 4, n2: 2 },
		);

		expect(() => insertPart(sqlite, 'dup', 'm4', 0, 1)).not.toThrow();
		expect(() => insertPart(sqlite, 'dup-2', 'm4', 0, 1)).toThrow();
		sqlite.close();
	});
});
