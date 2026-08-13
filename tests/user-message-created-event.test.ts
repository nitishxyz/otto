import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subscribe } from '../packages/server/src/events/bus.ts';
import { createUserMessage } from '../packages/server/src/runtime/message/create.ts';

let projectRoot = '';

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-user-message-event-'));
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('user message.created events', () => {
	test('publishes the complete persisted message metadata and visible content', async () => {
		const db = await getDb(projectRoot);
		const sessionId = crypto.randomUUID();
		const createdAt = Date.now();
		await db.insert(sessions).values({
			id: sessionId,
			agent: 'build',
			provider: 'anthropic',
			model: 'claude',
			projectPath: projectRoot,
			createdAt,
		});

		let eventPayload: Record<string, unknown> | undefined;
		const unsubscribe = subscribe(sessionId, (event) => {
			if (event.type === 'message.created' && event.payload?.role === 'user') {
				eventPayload = event.payload;
			}
		});

		try {
			const { userMessageId } = await createUserMessage({
				db,
				sessionId,
				agent: 'build',
				provider: 'anthropic',
				model: 'claude',
				content: 'visible immediately',
				createdAt,
				images: [
					{
						data: '',
						mediaType: 'image/png',
						name: 'screenshot.png',
					},
				],
			});

			expect(eventPayload).toMatchObject({
				id: userMessageId,
				sessionId,
				role: 'user',
				status: 'complete',
				content: 'visible immediately',
				createdAt,
				completedAt: createdAt,
				attachmentNames: ['screenshot.png'],
			});
		} finally {
			unsubscribe();
		}
	});
});
