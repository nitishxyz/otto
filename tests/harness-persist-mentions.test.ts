import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { createUserMessage } from '../packages/server/src/runtime/message/create.ts';
import {
	preprocessFileMentionsForModel,
	resolveFileMentionReferences,
} from '../packages/server/src/runtime/message/file-mentions.ts';
import { buildHistoryMessages } from '../packages/server/src/runtime/message/history-builder.ts';

let root: string;
let outside: string;

beforeEach(async () => {
	root = await fs.mkdtemp(join(tmpdir(), 'otto-harness-mentions-'));
	outside = await fs.mkdtemp(join(tmpdir(), 'otto-harness-outside-'));
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
	await fs.rm(outside, { recursive: true, force: true });
});

describe('file mention confinement', () => {
	test('rejects symlinks that escape the project root', async () => {
		await fs.writeFile(join(outside, 'secret.txt'), 'TOP SECRET');
		await fs.symlink(join(outside, 'secret.txt'), join(root, 'link.txt'));

		const references = await resolveFileMentionReferences({
			text: 'read @link.txt',
			projectRoot: root,
		});
		expect(references).toEqual([]);

		const preprocessed = await preprocessFileMentionsForModel({
			text: 'read @link.txt',
			projectRoot: root,
		});
		expect(preprocessed.text).not.toContain('TOP SECRET');
		expect(preprocessed.mentionedFiles).toHaveLength(0);
	});
});

describe('history projection purity', () => {
	test('replays the dispatch-time mention snapshot instead of the current file', async () => {
		const db = await getDb(root);
		const sessionId = crypto.randomUUID();
		await db.insert(sessions).values({
			id: sessionId,
			agent: 'build',
			provider: 'openai',
			model: 'gpt',
			projectPath: root,
			createdAt: Date.now(),
		});
		await fs.writeFile(join(root, 'notes.md'), 'VERSION ONE');
		const snapshot = await preprocessFileMentionsForModel({
			text: 'summarize @notes.md',
			projectRoot: root,
		});
		await createUserMessage({
			db,
			sessionId,
			agent: 'build',
			provider: 'openai',
			model: 'gpt',
			content: 'summarize @notes.md',
			createdAt: Date.now(),
			mentionSnapshotText: snapshot.text,
		});
		await fs.writeFile(join(root, 'notes.md'), 'VERSION TWO');

		const serialized = JSON.stringify(
			await buildHistoryMessages(db, sessionId, undefined, {
				projectRoot: root,
			}),
		);
		expect(serialized).toContain('VERSION ONE');
		expect(serialized).not.toContain('VERSION TWO');
	});
});
