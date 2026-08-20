import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getDb } from '@ottocode/database';
import { messageParts, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createPendingAssistantMessage,
	createUserMessage,
} from '../packages/server/src/runtime/message/create.ts';
import {
	MAX_CONTEXT_BYTES,
	injectMessageContext,
	prepareMessageContext,
} from '../packages/server/src/runtime/message/context.ts';
import { buildHistoryMessages } from '../packages/server/src/runtime/message/history-builder.ts';

let projectRoot = '';

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-message-context-'));
	await writeFile(join(projectRoot, 'example.ts'), 'first\nsecond\nthird\n');
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('message context injection', () => {
	test('appends synthetic reads at the active assistant tail', async () => {
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
		await createUserMessage({
			db,
			sessionId,
			agent: 'build',
			provider: 'anthropic',
			model: 'claude',
			content: 'Use @example.ts.',
			createdAt,
			preloadedFileMentions: ['example.ts'],
		});
		const { assistantMessageId } = await createPendingAssistantMessage({
			db,
			sessionId,
			agent: 'build',
			provider: 'anthropic',
			model: 'claude',
		});
		const prepared = await prepareMessageContext(projectRoot, {
			files: [{ path: 'example.ts', startLine: 2, endLine: 3 }],
		});

		const estimatedTokens = await injectMessageContext({
			db,
			sessionId,
			messageId: assistantMessageId,
			agent: 'build',
			provider: 'anthropic',
			model: 'claude',
			prepared,
		});

		expect(estimatedTokens).toBeGreaterThan(0);
		const parts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, assistantMessageId))
			.orderBy(messageParts.index);
		expect(parts).toHaveLength(2);
		const call = JSON.parse(parts[0]?.content ?? '{}');
		const result = JSON.parse(parts[1]?.content ?? '{}');
		expect(call).toMatchObject({
			name: 'read',
			args: { path: 'example.ts', startLine: 2, endLine: 3 },
			synthetic: true,
			origin: 'message_context',
		});
		expect(result).toMatchObject({
			name: 'read',
			callId: call.callId,
			synthetic: true,
			origin: 'message_context',
			context: {
				fileCount: 1,
				requestedFileCount: 1,
				deduplicatedFileCount: 0,
				totalBytes: expect.any(Number),
				preloadDurationMs: expect.any(Number),
				digest: expect.any(String),
			},
			result: {
				ok: true,
				path: 'example.ts',
				content: 'second\nthird',
				lineRange: '@2-3',
				totalLines: 4,
			},
		});

		const history = await buildHistoryMessages(
			db,
			sessionId,
			assistantMessageId,
			{ projectRoot },
		);
		expect(history.map((message) => message.role)).toEqual([
			'user',
			'assistant',
			'tool',
		]);
		expect(history[0]).toEqual({
			role: 'user',
			content: [{ type: 'text', text: 'Use example.ts.' }],
		});
		expect(history[1]).toMatchObject({
			role: 'assistant',
			content: [
				{
					type: 'tool-call',
					toolCallId: call.callId,
					toolName: 'read',
					input: call.args,
				},
			],
		});
		const toolContent = history[2]?.content;
		expect(Array.isArray(toolContent)).toBe(true);
		if (!Array.isArray(toolContent)) throw new Error('Expected tool content');
		const output = toolContent[0]?.output;
		expect(output).toMatchObject({ type: 'text' });
		if (!output || output.type !== 'text') {
			throw new Error('Expected text tool output');
		}
		expect(JSON.parse(output.value)).toMatchObject({
			ok: true,
			path: 'example.ts',
			content: 'second\nthird',
		});
	});

	test('deduplicates identical references before reading and persistence', async () => {
		const prepared = await prepareMessageContext(projectRoot, {
			files: [
				{ path: 'example.ts', startLine: 1, maxLines: 2 },
				{ path: 'example.ts', startLine: 1, maxLines: 2 },
			],
		});

		expect(prepared).toMatchObject({
			requestedFileCount: 2,
			deduplicatedFileCount: 1,
		});
		expect(prepared?.reads).toHaveLength(1);
	});

	test('deduplicates an explicit context file and matching file mention', async () => {
		const prepared = await prepareMessageContext(
			projectRoot,
			{ files: [{ path: 'example.ts' }] },
			{ optionalFiles: [{ path: 'example.ts' }] },
		);

		expect(prepared).toMatchObject({
			requestedFileCount: 2,
			deduplicatedFileCount: 1,
			omittedFileCount: 0,
		});
		expect(prepared?.reads).toHaveLength(1);
	});

	test('validates ranges and gives endLine precedence over maxLines', async () => {
		await expect(
			prepareMessageContext(projectRoot, {
				files: [{ path: 'example.ts', endLine: 2 }],
			}),
		).rejects.toMatchObject({ code: 'invalid_context_range', status: 400 });
		const prepared = await prepareMessageContext(projectRoot, {
			files: [
				{
					path: 'example.ts',
					startLine: 2,
					endLine: 3,
					maxLines: 1,
				},
			],
		});
		expect(prepared?.reads[0]?.result).toMatchObject({
			content: 'second\nthird',
			lineRange: '@2-3',
		});
		await expect(
			prepareMessageContext(projectRoot, {
				files: [{ path: 'example.ts', startLine: 3, endLine: 2 }],
			}),
		).rejects.toMatchObject({ code: 'invalid_context_range', status: 400 });
	});

	test('rejects context larger than the total byte budget', async () => {
		await writeFile(
			join(projectRoot, 'oversized.txt'),
			'x'.repeat(MAX_CONTEXT_BYTES + 1),
		);
		await expect(
			prepareMessageContext(projectRoot, {
				files: [{ path: 'oversized.txt' }],
			}),
		).rejects.toMatchObject({ code: 'context_size_limit', status: 413 });
	});

	test('omits oversized optional mention context without rejecting the message', async () => {
		await writeFile(
			join(projectRoot, 'oversized.txt'),
			'x'.repeat(MAX_CONTEXT_BYTES + 1),
		);
		const prepared = await prepareMessageContext(projectRoot, undefined, {
			optionalFiles: [{ path: 'oversized.txt' }],
		});

		expect(prepared).toMatchObject({
			reads: [],
			omittedFileCount: 1,
		});
	});
});
