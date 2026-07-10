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
