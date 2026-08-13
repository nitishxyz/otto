import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { createEmbeddedApp } from '@ottocode/server';
import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withProject(
	prefix: string,
	fn: (projectRoot: string) => Promise<void>,
): Promise<void> {
	const projectRoot = await mkdtemp(join(tmpdir(), prefix));
	const previousOttoHome = process.env.OTTO_HOME;
	const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
	process.env.OTTO_HOME = join(projectRoot, 'otto-home');
	process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
	await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true });

	try {
		await fn(projectRoot);
	} finally {
		if (previousOttoHome === undefined) delete process.env.OTTO_HOME;
		else process.env.OTTO_HOME = previousOttoHome;
		if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
		await rm(projectRoot, { recursive: true, force: true });
	}
}

function messageUrl(
	projectRoot: string,
	sessionId = 'missing-session',
): string {
	return `/v1/sessions/${sessionId}/messages?project=${encodeURIComponent(projectRoot)}`;
}

async function sendMessage(
	projectRoot: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return createEmbeddedApp().request(messageUrl(projectRoot), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ content: 'attachment test', ...body }),
	});
}

describe('message attachment limits', () => {
	it('rejects more than ten attachments', async () => {
		await withProject('otto-attachment-count-', async (projectRoot) => {
			const response = await sendMessage(projectRoot, {
				files: Array.from({ length: 11 }, (_, index) => ({
					name: `file-${index}.txt`,
					textContent: 'small',
				})),
			});

			expect(response.status).toBe(413);
			expect(await response.json()).toEqual({
				error: 'A message can include at most 10 attachments.',
			});
		});
	});

	it('rejects an attachment larger than five megabytes', async () => {
		await withProject('otto-attachment-file-size-', async (projectRoot) => {
			const response = await sendMessage(projectRoot, {
				files: [
					{
						name: 'large.bin',
						data: 'A'.repeat(7_000_000),
					},
				],
			});

			expect(response.status).toBe(413);
			const body = (await response.json()) as { error: string };
			expect(body.error).toContain('large.bin');
			expect(body.error).toContain('5 MB');
		});
	});

	it('rejects attachments larger than twenty megabytes in total', async () => {
		await withProject('otto-attachment-total-size-', async (projectRoot) => {
			const data = 'A'.repeat(5_600_000);
			const response = await sendMessage(projectRoot, {
				files: Array.from({ length: 5 }, (_, index) => ({
					name: `part-${index}.bin`,
					data,
				})),
			});

			expect(response.status).toBe(413);
			expect(await response.json()).toEqual({
				error: 'Attachments exceed the 20 MB total limit.',
			});
		});
	});

	it('rejects declared request bodies larger than sixty-four megabytes', async () => {
		const request = new Request(
			'http://localhost/v1/sessions/missing-session/messages',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			},
		);
		request.headers.set('content-length', String(64 * 1024 * 1024 + 1));
		const response = await createEmbeddedApp().fetch(request);

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: 'Message request exceeds the 64 MB limit.',
		});
	});
});

describe('message attachment list payloads', () => {
	it('omits persisted inline data when an attachment id is available', async () => {
		await withProject('otto-attachment-list-', async (projectRoot) => {
			const db = await getDb(projectRoot);
			const sessionId = crypto.randomUUID();
			const messageId = crypto.randomUUID();
			const partId = crypto.randomUUID();
			const attachmentContent = {
				type: 'text',
				name: 'notes.txt',
				mediaType: 'text/plain',
				data: 'aGVsbG8=',
				textContent: 'hello',
				attachmentId: 'stored-attachment-id',
			};

			await db.insert(sessions).values({
				id: sessionId,
				title: 'Attachment payload test',
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
				projectPath: projectRoot,
				createdAt: Date.now(),
			});
			await db.insert(messages).values({
				id: messageId,
				sessionId,
				role: 'user',
				status: 'complete',
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
				createdAt: Date.now(),
			});
			await db.insert(messageParts).values({
				id: partId,
				messageId,
				index: 0,
				type: 'file',
				content: JSON.stringify(attachmentContent),
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
			});

			const response = await createEmbeddedApp().request(
				messageUrl(projectRoot, sessionId),
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as Array<{
				parts: Array<{
					content: string;
					contentJson: Record<string, unknown>;
				}>;
			}>;
			const part = body[0]?.parts[0];
			const expected = {
				type: 'text',
				name: 'notes.txt',
				mediaType: 'text/plain',
				attachmentId: 'stored-attachment-id',
				dataOmitted: true,
			};

			expect(part?.contentJson).toEqual(expected);
			expect(JSON.parse(part?.content ?? '{}')).toEqual(expected);
		});
	});
});

describe('message page payloads', () => {
	it('keeps insertion order when a user and assistant share a timestamp', async () => {
		await withProject('otto-message-tie-order-', async (projectRoot) => {
			const db = await getDb(projectRoot);
			const sessionId = crypto.randomUUID();
			const userId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
			const assistantId = '00000000-0000-4000-8000-000000000000';
			await db.insert(sessions).values({
				id: sessionId,
				title: 'Equal timestamp ordering test',
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
				projectPath: projectRoot,
				createdAt: 1_000,
			});
			for (const [role, id] of [
				['user', userId],
				['assistant', assistantId],
			] as const) {
				await db.insert(messages).values({
					id,
					sessionId,
					role,
					status: 'complete',
					agent: 'general',
					provider: 'openai',
					model: 'test-model',
					createdAt: 2_000,
				});
			}

			const response = await createEmbeddedApp().request(
				`/v1/sessions/${sessionId}/messages/page?project=${encodeURIComponent(
					projectRoot,
				)}`,
			);
			const payload = (await response.json()) as {
				items: Array<{ id: string }>;
			};
			expect(response.status).toBe(200);
			expect(payload.items.map((message) => message.id)).toEqual([
				userId,
				assistantId,
			]);
		});
	});

	it('extends a soft part target to include two complete turns', async () => {
		await withProject('otto-message-turn-page-', async (projectRoot) => {
			const db = await getDb(projectRoot);
			const sessionId = crypto.randomUUID();
			const messageIds = Array.from({ length: 6 }, () => crypto.randomUUID());
			await db.insert(sessions).values({
				id: sessionId,
				title: 'Adaptive pagination test',
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
				projectPath: projectRoot,
				createdAt: 1_000,
			});
			for (const [index, id] of messageIds.entries()) {
				const role = index % 2 === 0 ? 'user' : 'assistant';
				await db.insert(messages).values({
					id,
					sessionId,
					role,
					status: 'complete',
					agent: 'general',
					provider: 'openai',
					model: 'test-model',
					createdAt: 1_000 + index,
				});
				await db.insert(messageParts).values({
					id: crypto.randomUUID(),
					messageId: id,
					index: 0,
					type: 'text',
					content: JSON.stringify({ text: `${role}-${index}` }),
					agent: 'general',
					provider: 'openai',
					model: 'test-model',
				});
			}

			const pageUrl = `/v1/sessions/${sessionId}/messages/page?project=${encodeURIComponent(
				projectRoot,
			)}&limit=2&parsed=true`;
			const firstResponse = await createEmbeddedApp().request(pageUrl);
			const first = (await firstResponse.json()) as {
				items: Array<{ id: string }>;
				partCount: number;
				hasMore: boolean;
				nextCursor: string | null;
			};
			expect(first.items.map((message) => message.id)).toEqual(
				messageIds.slice(2),
			);
			expect(first.partCount).toBe(4);
			expect(first.hasMore).toBe(true);

			const secondResponse = await createEmbeddedApp().request(
				`${pageUrl}&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
			);
			const second = (await secondResponse.json()) as {
				items: Array<{ id: string }>;
				partCount: number;
				hasMore: boolean;
			};
			expect(second.items.map((message) => message.id)).toEqual(
				messageIds.slice(0, 2),
			);
			expect(second.partCount).toBe(2);
			expect(second.hasMore).toBe(false);

			const softTargetResponse = await createEmbeddedApp().request(
				pageUrl.replace('limit=2', 'limit=6'),
			);
			const softTargetPage = (await softTargetResponse.json()) as {
				items: Array<{ id: string }>;
				partCount: number;
				hasMore: boolean;
			};
			expect(softTargetPage.items.map((message) => message.id)).toEqual(
				messageIds,
			);
			expect(softTargetPage.partCount).toBe(6);
			expect(softTargetPage.hasMore).toBe(false);
		});
	});

	it('returns every part when a complete turn exceeds the soft target', async () => {
		await withProject('otto-message-large-turn-', async (projectRoot) => {
			const db = await getDb(projectRoot);
			const sessionId = crypto.randomUUID();
			const userMessageId = crypto.randomUUID();
			const assistantMessageId = crypto.randomUUID();
			await db.insert(sessions).values({
				id: sessionId,
				title: 'Large turn pagination test',
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
				projectPath: projectRoot,
				createdAt: 1_000,
			});
			for (const [id, role, createdAt] of [
				[userMessageId, 'user', 1_000],
				[assistantMessageId, 'assistant', 1_001],
			] as const) {
				await db.insert(messages).values({
					id,
					sessionId,
					role,
					status: 'complete',
					agent: 'general',
					provider: 'openai',
					model: 'test-model',
					createdAt,
				});
			}
			await db.insert(messageParts).values({
				id: crypto.randomUUID(),
				messageId: userMessageId,
				index: 0,
				type: 'text',
				content: JSON.stringify({ text: 'user' }),
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
			});
			for (let index = 0; index < 510; index++) {
				await db.insert(messageParts).values({
					id: crypto.randomUUID(),
					messageId: assistantMessageId,
					index,
					type: 'text',
					content: JSON.stringify({ text: `part-${index}` }),
					agent: 'general',
					provider: 'openai',
					model: 'test-model',
				});
			}

			const pageUrl = `/v1/sessions/${sessionId}/messages/page?project=${encodeURIComponent(
				projectRoot,
			)}&limit=120&parsed=true`;
			const first = (await (
				await createEmbeddedApp().request(pageUrl)
			).json()) as {
				items: Array<{ id: string; parts: Array<{ index: number }> }>;
				partCount: number;
				hasMore: boolean;
				nextCursor: string | null;
			};
			expect(first.partCount).toBe(511);
			expect(first.items.map((message) => message.id)).toEqual([
				userMessageId,
				assistantMessageId,
			]);
			expect(first.items[1]?.parts).toHaveLength(510);
			expect(first.hasMore).toBe(false);
			expect(first.nextCursor).toBeNull();
		});
	});

	it('includes a pending assistant that has not emitted a part yet', async () => {
		await withProject('otto-message-pending-page-', async (projectRoot) => {
			const app = createEmbeddedApp();
			await app.request(
				`/v1/sessions?project=${encodeURIComponent(projectRoot)}`,
			);
			const db = await getDb(projectRoot);
			const sessionId = crypto.randomUUID();
			const messageId = crypto.randomUUID();
			await db.insert(sessions).values({
				id: sessionId,
				title: 'Pending page test',
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
				projectPath: projectRoot,
				createdAt: 1_000,
			});
			await db.insert(messages).values({
				id: messageId,
				sessionId,
				role: 'assistant',
				status: 'pending',
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
				createdAt: 1_000,
			});

			const response = await app.request(
				`/v1/sessions/${sessionId}/messages/page?project=${encodeURIComponent(
					projectRoot,
				)}&parsed=true`,
			);
			const page = (await response.json()) as {
				items: Array<{ id: string; status: string; parts: unknown[] }>;
				partCount: number;
				hasMore: boolean;
			};
			expect(page.items).toHaveLength(1);
			expect(page.items[0]).toMatchObject({
				id: messageId,
				status: 'pending',
				parts: [],
			});
			expect(page.partCount).toBe(0);
			expect(page.hasMore).toBe(false);
		});
	});

	it('replaces oversized tool results with an artifact reference', async () => {
		await withProject('otto-message-artifact-', async (projectRoot) => {
			const db = await getDb(projectRoot);
			const sessionId = crypto.randomUUID();
			const messageId = crypto.randomUUID();
			const partId = crypto.randomUUID();
			const largeContent = JSON.stringify({
				name: 'read',
				result: { content: 'x'.repeat(300 * 1024) },
			});
			await db.insert(sessions).values({
				id: sessionId,
				title: 'Artifact test',
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
				projectPath: projectRoot,
				createdAt: Date.now(),
			});
			await db.insert(messages).values({
				id: messageId,
				sessionId,
				role: 'assistant',
				status: 'complete',
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
				createdAt: Date.now(),
			});
			await db.insert(messageParts).values({
				id: partId,
				messageId,
				index: 0,
				type: 'tool_result',
				content: largeContent,
				agent: 'general',
				provider: 'openai',
				model: 'test-model',
			});

			const response = await createEmbeddedApp().request(
				`/v1/sessions/${sessionId}/messages/page?project=${encodeURIComponent(
					projectRoot,
				)}&parsed=true`,
			);
			const page = (await response.json()) as {
				items: Array<{
					parts: Array<{
						contentTruncated?: boolean;
						artifactPath?: string;
					}>;
				}>;
			};
			const part = page.items[0]?.parts[0];
			expect(part?.contentTruncated).toBe(true);
			expect(part?.artifactPath).toContain(partId);

			const artifactResponse = await createEmbeddedApp().request(
				`${part?.artifactPath}?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(artifactResponse.status).toBe(200);
			expect(await artifactResponse.text()).toBe(largeContent);
		});
	});
});
