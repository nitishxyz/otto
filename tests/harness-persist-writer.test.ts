import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDbByPath } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import {
	flushPartContentWrites,
	PartContentPersistenceError,
	partContentWriterTesting,
	queuePartContentWrite,
	shutdownPartContentWriter,
} from '../packages/server/src/runtime/persistence/part-content-writer.ts';

const tempDir = mkdtempSync(join(tmpdir(), 'otto-harness-writer-'));
const dbPath = join(tempDir, 'test.sqlite');

afterAll(async () => {
	await shutdownPartContentWriter().catch(() => undefined);
	partContentWriterTesting.reset();
	rmSync(tempDir, { recursive: true, force: true });
});

type TestDb = Awaited<ReturnType<typeof getDbByPath>>;

async function insertPart(db: TestDb) {
	const partId = crypto.randomUUID();
	await db.insert(messageParts).values({
		id: partId,
		messageId: crypto.randomUUID(),
		index: 0,
		type: 'text',
		content: JSON.stringify({ text: '' }),
		agent: 'build',
		provider: 'anthropic',
		model: 'test-model',
		startedAt: Date.now(),
	});
	return partId;
}

async function readContent(db: TestDb, partId: string) {
	const rows = await db
		.select({ content: messageParts.content })
		.from(messageParts)
		.where(eq(messageParts.id, partId));
	return rows[0]?.content;
}

function failingDb(message: string) {
	return {
		update() {
			return {
				set() {
					return {
						where: async () => {
							throw new Error(message);
						},
					};
				},
			};
		},
	};
}

function recordingDb(written: string[]) {
	return {
		update() {
			return {
				set(values: { content: string }) {
					return {
						where: async () => {
							written.push(values.content);
						},
					};
				},
			};
		},
	};
}

describe('truthful part content writer', () => {
	it('rejects the barrier when a write cannot be committed', async () => {
		queuePartContentWrite(
			failingDb('disk full') as never,
			crypto.randomUUID(),
			'lost content',
		);
		const flushed = flushPartContentWrites();
		await expect(flushed).rejects.toBeInstanceOf(PartContentPersistenceError);
		await expect(flushed).rejects.toThrow('disk full');
		// The failure is reported once; later barriers are not poisoned.
		await expect(flushPartContentWrites()).resolves.toBeUndefined();
	});

	it('does not resolve a barrier on a superseded write until the superseding write commits', async () => {
		const written: string[] = [];
		const db = recordingDb(written) as never;
		const partId = crypto.randomUUID();
		queuePartContentWrite(db, partId, 'old');
		const barrier = flushPartContentWrites();
		// Supersede before the in-process fallback runs.
		queuePartContentWrite(db, partId, 'new');
		await barrier;
		expect(written).toEqual(['new']);
		expect(partContentWriterTesting.unacknowledgedCount()).toBe(0);
	});

	it('rejects a barrier whose superseding write fails', async () => {
		const partId = crypto.randomUUID();
		queuePartContentWrite(recordingDb([]) as never, partId, 'old');
		const barrier = flushPartContentWrites();
		queuePartContentWrite(failingDb('disk full') as never, partId, 'new');
		await expect(barrier).rejects.toBeInstanceOf(PartContentPersistenceError);
		await expect(flushPartContentWrites()).resolves.toBeUndefined();
	});

	it('rejects every concurrent barrier covering the same failing write', async () => {
		queuePartContentWrite(
			failingDb('disk full') as never,
			crypto.randomUUID(),
			'lost content',
		);
		const results = await Promise.allSettled([
			flushPartContentWrites(),
			flushPartContentWrites(),
		]);
		expect(results.map((result) => result.status)).toEqual([
			'rejected',
			'rejected',
		]);
		for (const result of results) {
			if (result.status === 'rejected') {
				expect(result.reason).toBeInstanceOf(PartContentPersistenceError);
			}
		}
		await expect(flushPartContentWrites()).resolves.toBeUndefined();
	});

	it('reports a failure with no open barrier exactly once', async () => {
		queuePartContentWrite(
			failingDb('disk full') as never,
			crypto.randomUUID(),
			'lost content',
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await expect(flushPartContentWrites()).rejects.toThrow('disk full');
		await expect(flushPartContentWrites()).resolves.toBeUndefined();
	});

	it('replays unacknowledged writes when the worker dies mid-flight', async () => {
		const db = await getDbByPath(dbPath);
		const partId = await insertPart(db);
		// Warm the worker so the write is dispatched to it.
		queuePartContentWrite(db, partId, JSON.stringify({ text: 'warm' }));
		await flushPartContentWrites();

		queuePartContentWrite(db, partId, JSON.stringify({ text: 'in-flight' }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		partContentWriterTesting.crashWorker();
		await flushPartContentWrites();

		expect(await readContent(db, partId)).toBe(
			JSON.stringify({ text: 'in-flight' }),
		);
		expect(partContentWriterTesting.unacknowledgedCount()).toBe(0);
		partContentWriterTesting.reset();
	});

	it('acknowledges only the latest write per part', async () => {
		const db = await getDbByPath(dbPath);
		const partId = await insertPart(db);
		queuePartContentWrite(db, partId, JSON.stringify({ text: 'a' }));
		queuePartContentWrite(db, partId, JSON.stringify({ text: 'ab' }));
		await flushPartContentWrites();
		expect(partContentWriterTesting.unacknowledgedCount()).toBe(0);
		expect(await readContent(db, partId)).toBe(JSON.stringify({ text: 'ab' }));
	});
});
