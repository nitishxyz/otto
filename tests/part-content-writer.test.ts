import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDbByPath } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import {
	flushPartContentWrites,
	queuePartContentWrite,
	shutdownPartContentWriter,
} from '../packages/server/src/runtime/persistence/part-content-writer.ts';

const tempDir = mkdtempSync(join(tmpdir(), 'otto-part-writer-'));
const dbPath = join(tempDir, 'test.sqlite');

afterAll(async () => {
	await shutdownPartContentWriter();
	rmSync(tempDir, { recursive: true, force: true });
});

async function insertPart(db: Awaited<ReturnType<typeof getDbByPath>>) {
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

async function readContent(
	db: Awaited<ReturnType<typeof getDbByPath>>,
	partId: string,
) {
	const rows = await db
		.select({ content: messageParts.content })
		.from(messageParts)
		.where(eq(messageParts.id, partId));
	return rows[0]?.content;
}

describe('part content write-behind queue', () => {
	it('persists the latest queued content through the worker after flush', async () => {
		const db = await getDbByPath(dbPath);
		const partId = await insertPart(db);

		queuePartContentWrite(db, partId, JSON.stringify({ text: 'a' }));
		queuePartContentWrite(db, partId, JSON.stringify({ text: 'ab' }));
		queuePartContentWrite(db, partId, JSON.stringify({ text: 'abc' }));
		await flushPartContentWrites();

		expect(await readContent(db, partId)).toBe(JSON.stringify({ text: 'abc' }));
	});

	it('handles interleaved writes to multiple parts', async () => {
		const db = await getDbByPath(dbPath);
		const partA = await insertPart(db);
		const partB = await insertPart(db);

		queuePartContentWrite(db, partA, JSON.stringify({ text: 'A1' }));
		queuePartContentWrite(db, partB, JSON.stringify({ text: 'B1' }));
		queuePartContentWrite(db, partA, JSON.stringify({ text: 'A2' }));
		await flushPartContentWrites();

		expect(await readContent(db, partA)).toBe(JSON.stringify({ text: 'A2' }));
		expect(await readContent(db, partB)).toBe(JSON.stringify({ text: 'B1' }));
	});

	it('is durable across sequential flush barriers', async () => {
		const db = await getDbByPath(dbPath);
		const partId = await insertPart(db);

		queuePartContentWrite(db, partId, JSON.stringify({ text: 'step-1' }));
		await flushPartContentWrites();
		expect(await readContent(db, partId)).toBe(
			JSON.stringify({ text: 'step-1' }),
		);

		queuePartContentWrite(db, partId, JSON.stringify({ text: 'step-1 done' }));
		await flushPartContentWrites();
		expect(await readContent(db, partId)).toBe(
			JSON.stringify({ text: 'step-1 done' }),
		);
	});

	it('falls back to in-process writes for dbs without a file path', async () => {
		const updates: Array<{ content: string }> = [];
		const fakeDb = {
			update() {
				return {
					set(values: { content: string }) {
						return {
							where: async () => {
								updates.push(values);
							},
						};
					},
				};
			},
		};

		const partId = crypto.randomUUID();
		queuePartContentWrite(fakeDb as never, partId, 'v1');
		queuePartContentWrite(fakeDb as never, partId, 'v2');
		await flushPartContentWrites();

		expect(updates).toHaveLength(1);
		expect(updates[0]?.content).toBe('v2');
	});
});
