import { describe, expect, test } from 'bun:test';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { asc, eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	consumeOauthCodexTextDelta,
	createOauthCodexTextGuardState,
	resetOauthCodexTextGuard,
	stripCodexPseudoToolText,
} from '../packages/server/src/runtime/stream/text-guard.ts';
import { markSessionCompacted } from '../packages/server/src/runtime/message/compaction-mark.ts';
import { buildHistoryMessages } from '../packages/server/src/runtime/message/history-builder.ts';

describe('oauth codex text guard', () => {
	test('keeps normal assistant text unchanged', () => {
		const input = 'I will inspect the code and run tests next.';
		const result = stripCodexPseudoToolText(input);
		expect(result.sanitized).toBe(input);
		expect(result.dropped).toBe(false);
	});

	test('drops leaked pseudo tool-call suffix', () => {
		const input =
			'Next I will read the files. assistant to=functions.ls commentary {"path":"."}';
		const result = stripCodexPseudoToolText(input);
		expect(result.sanitized).toBe('Next I will read the files.');
		expect(result.dropped).toBe(true);
	});

	test('drops leaked "assistant to" suffix without equals', () => {
		const input = 'Working... assistant to functions.exec_command commentary';
		const result = stripCodexPseudoToolText(input);
		expect(result.sanitized).toBe('Working...');
		expect(result.dropped).toBe(true);
	});

	test('drops leaked trailing assistant token', () => {
		const input = 'Applying fix now. assistant';
		const result = stripCodexPseudoToolText(input);
		expect(result.sanitized).toBe('Applying fix now.');
		expect(result.dropped).toBe(true);
	});

	test('drops leaked call:tool pseudo syntax', () => {
		const input = 'Working now... call:tool{"name":"ls"}';
		const result = stripCodexPseudoToolText(input);
		expect(result.sanitized).toBe('Working now...');
		expect(result.dropped).toBe(true);
	});

	test('handles leakage split across stream chunks', () => {
		const state = createOauthCodexTextGuardState();
		const chunks = [
			'I found the right file. ',
			'assistant to=fun',
			'ctions.ls commentary {"path":"."}',
			' this should never show',
		];

		const emitted = chunks
			.map((chunk) => consumeOauthCodexTextDelta(state, chunk))
			.join('');

		expect(emitted).toBe('I found the right file. ');
		expect(state.dropped).toBe(true);
	});

	test('reset after tool boundary lets post-tool prose flow again', () => {
		const state = createOauthCodexTextGuardState();

		// Pre-tool text ends with a pseudo tool-call leak.
		const before = consumeOauthCodexTextDelta(
			state,
			'Let me check. assistant to=functions.shell commentary {"cmd":"ls"}',
		);
		expect(before).toBe('Let me check.');
		expect(state.dropped).toBe(true);

		// Without a reset, EVERYTHING after the leak stays dropped.
		expect(consumeOauthCodexTextDelta(state, ' The tests pass.')).toBe('');

		// Structured tool part arrives -> runner resets the window.
		resetOauthCodexTextGuard(state);

		const after = consumeOauthCodexTextDelta(
			state,
			'All 4 tests pass, moving on.',
		);
		expect(after).toBe('All 4 tests pass, moving on.');
		expect(state.dropped).toBe(false);
	});

	test('treats legacy assistant status "completed" as complete', async () => {
		const projectRoot = mkdtempSync(join(tmpdir(), 'otto-oauth-guard-'));
		const db = await getDb(projectRoot);
		const now = Date.now();

		await db.insert(sessions).values({
			id: 'session-status-test',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			projectPath: projectRoot,
			createdAt: now,
			lastActiveAt: now,
		});

		await db.insert(messages).values({
			id: 'user-msg',
			sessionId: 'session-status-test',
			role: 'user',
			status: 'complete',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			createdAt: now,
		});

		await db.insert(messageParts).values({
			id: 'user-part',
			messageId: 'user-msg',
			index: 0,
			type: 'text',
			content: JSON.stringify({ text: 'hello' }),
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
		});

		await db.insert(messages).values({
			id: 'assistant-msg',
			sessionId: 'session-status-test',
			role: 'assistant',
			status: 'completed',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			createdAt: now + 1,
		});

		await db.insert(messageParts).values({
			id: 'assistant-part',
			messageId: 'assistant-msg',
			index: 0,
			type: 'text',
			content: JSON.stringify({ text: 'world' }),
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
		});

		const history = await buildHistoryMessages(db, 'session-status-test');
		expect(history.length).toBe(2);
		expect(history[0]?.role).toBe('user');
		expect(history[1]?.role).toBe('assistant');
	});

	test('preserves assistant tool chronology when rebuilding history', async () => {
		const projectRoot = mkdtempSync(join(tmpdir(), 'otto-history-order-'));
		const db = await getDb(projectRoot);
		const now = Date.now();

		await db.insert(sessions).values({
			id: 'session-history-order-test',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			projectPath: projectRoot,
			createdAt: now,
			lastActiveAt: now,
		});

		await db.insert(messages).values({
			id: 'user-history-order-msg',
			sessionId: 'session-history-order-test',
			role: 'user',
			status: 'complete',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			createdAt: now,
		});

		await db.insert(messageParts).values({
			id: 'user-history-order-part',
			messageId: 'user-history-order-msg',
			index: 0,
			type: 'text',
			content: JSON.stringify({ text: 'read README' }),
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
		});

		await db.insert(messages).values({
			id: 'assistant-history-order-msg',
			sessionId: 'session-history-order-test',
			role: 'assistant',
			status: 'complete',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			createdAt: now + 1,
		});

		await db.insert(messageParts).values([
			{
				id: 'assistant-history-order-part-1',
				messageId: 'assistant-history-order-msg',
				index: 0,
				type: 'text',
				content: JSON.stringify({ text: "I'll read it now." }),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
			},
			{
				id: 'assistant-history-order-part-2',
				messageId: 'assistant-history-order-msg',
				index: 1,
				type: 'tool_call',
				content: JSON.stringify({
					name: 'read',
					callId: 'call-readme',
					args: { path: 'README.md' },
				}),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
			},
			{
				id: 'assistant-history-order-part-3',
				messageId: 'assistant-history-order-msg',
				index: 2,
				type: 'tool_result',
				content: JSON.stringify({
					name: 'read',
					callId: 'call-readme',
					result: { ok: true, path: 'README.md' },
				}),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
			},
			{
				id: 'assistant-history-order-part-4',
				messageId: 'assistant-history-order-msg',
				index: 3,
				type: 'text',
				content: JSON.stringify({ text: 'I read README.' }),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
			},
		]);

		const history = await buildHistoryMessages(
			db,
			'session-history-order-test',
		);
		expect(history).toEqual([
			{
				role: 'user',
				content: [{ type: 'text', text: 'read README' }],
			},
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: "I'll read it now." },
					{
						type: 'tool-call',
						toolCallId: 'call-readme',
						toolName: 'read',
						input: { path: 'README.md' },
					},
				],
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'call-readme',
						toolName: 'read',
						output: {
							type: 'text',
							value: '{"ok":true,"path":"README.md"}',
						},
					},
				],
			},
			{
				role: 'assistant',
				content: [{ type: 'text', text: 'I read README.' }],
			},
		]);
	});

	test('compacts tool call/result pairs together so history does not synthesize errors', async () => {
		const projectRoot = mkdtempSync(join(tmpdir(), 'otto-history-compaction-'));
		const db = await getDb(projectRoot);
		const now = Date.now();
		const largeText = 'x'.repeat(120_000);

		await db.insert(sessions).values({
			id: 'session-compaction-test',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			projectPath: projectRoot,
			createdAt: now,
			lastActiveAt: now,
		});

		await db.insert(messages).values([
			{
				id: 'assistant-compaction-msg',
				sessionId: 'session-compaction-test',
				role: 'assistant',
				status: 'complete',
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
				createdAt: now,
			},
			{
				id: 'compact-cutoff-msg',
				sessionId: 'session-compaction-test',
				role: 'assistant',
				status: 'complete',
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
				createdAt: now + 1,
			},
		]);

		await db.insert(messageParts).values([
			{
				id: 'assistant-compaction-text',
				messageId: 'assistant-compaction-msg',
				index: 0,
				type: 'text',
				content: JSON.stringify({ text: 'Working through the repo.' }),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
			},
			{
				id: 'assistant-compaction-tool-call',
				messageId: 'assistant-compaction-msg',
				index: 1,
				type: 'tool_call',
				content: JSON.stringify({
					name: 'read',
					callId: 'call-compaction-read',
					args: { path: largeText },
				}),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
				toolName: 'read',
				toolCallId: 'call-compaction-read',
			},
			{
				id: 'assistant-compaction-tool-result',
				messageId: 'assistant-compaction-msg',
				index: 2,
				type: 'tool_result',
				content: JSON.stringify({
					name: 'read',
					callId: 'call-compaction-read',
					result: { ok: true, content: largeText },
				}),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
				toolName: 'read',
				toolCallId: 'call-compaction-read',
			},
			{
				id: 'assistant-compaction-after-text',
				messageId: 'assistant-compaction-msg',
				index: 3,
				type: 'text',
				content: JSON.stringify({ text: 'Done reading.' }),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
			},
		]);

		const compacted = await markSessionCompacted(
			db,
			'session-compaction-test',
			'compact-cutoff-msg',
		);
		expect(compacted.compacted).toBe(2);

		const compactedParts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, 'assistant-compaction-msg'))
			.orderBy(asc(messageParts.index));

		expect(
			compactedParts.find(
				(part) => part.id === 'assistant-compaction-tool-call',
			)?.compactedAt,
		).toBeTruthy();
		expect(
			compactedParts.find(
				(part) => part.id === 'assistant-compaction-tool-result',
			)?.compactedAt,
		).toBeTruthy();

		const history = await buildHistoryMessages(db, 'session-compaction-test');
		expect(history).toEqual([
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Working through the repo.' },
					{ type: 'text', text: 'Done reading.' },
				],
			},
		]);
	});

	test('keeps stored image attachments as raw file data in history', async () => {
		const projectRoot = mkdtempSync(join(tmpdir(), 'otto-history-images-'));
		const db = await getDb(projectRoot);
		const now = Date.now();

		await db.insert(sessions).values({
			id: 'session-image-test',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			projectPath: projectRoot,
			createdAt: now,
			lastActiveAt: now,
		});

		await db.insert(messages).values({
			id: 'user-image-msg',
			sessionId: 'session-image-test',
			role: 'user',
			status: 'complete',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			createdAt: now,
		});

		await db.insert(messageParts).values([
			{
				id: 'user-image-text-part',
				messageId: 'user-image-msg',
				index: 0,
				type: 'text',
				content: JSON.stringify({ text: 'what is in this image?' }),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
			},
			{
				id: 'user-image-part',
				messageId: 'user-image-msg',
				index: 1,
				type: 'image',
				content: JSON.stringify({
					data: 'ZmFrZS1pbWFnZS1ieXRlcw==',
					mediaType: 'image/png',
				}),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
			},
		]);

		const history = await buildHistoryMessages(db, 'session-image-test');
		expect(history).toHaveLength(1);
		expect(history[0]).toEqual({
			role: 'user',
			content: [
				{ type: 'text', text: 'what is in this image?' },
				{
					type: 'file',
					data: 'ZmFrZS1pbWFnZS1ieXRlcw==',
					mediaType: 'image/png',
				},
			],
		});
	});

	test('includes attachment ids in image history so originals can be copied', async () => {
		const projectRoot = mkdtempSync(join(tmpdir(), 'otto-history-image-id-'));
		const db = await getDb(projectRoot);
		const now = Date.now();

		await db.insert(sessions).values({
			id: 'session-image-id-test',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			projectPath: projectRoot,
			createdAt: now,
			lastActiveAt: now,
		});

		await db.insert(messages).values({
			id: 'user-image-id-msg',
			sessionId: 'session-image-id-test',
			role: 'user',
			status: 'complete',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			createdAt: now,
		});

		await db.insert(messageParts).values([
			{
				id: 'user-image-id-text-part',
				messageId: 'user-image-id-msg',
				index: 0,
				type: 'text',
				content: JSON.stringify({ text: 'use this image' }),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
			},
			{
				id: 'user-image-id-part',
				messageId: 'user-image-id-msg',
				index: 1,
				type: 'image',
				content: JSON.stringify({
					data: 'ZmFrZS1pbWFnZS1ieXRlcw==',
					mediaType: 'image/png',
					name: 'image.png',
					attachmentId: 'att_image_123',
					original: { filename: 'image.png', size: 1234 },
				}),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5.3-codex',
			},
		]);

		const history = await buildHistoryMessages(db, 'session-image-id-test');
		expect(history[0]).toEqual({
			role: 'user',
			content: [
				{ type: 'text', text: 'use this image' },
				{
					type: 'text',
					text: '[image attachment; name: image.png; mediaType: image/png; attachmentId: att_image_123; originalBytes: 1234]',
				},
				{
					type: 'file',
					data: 'ZmFrZS1pbWFnZS1ieXRlcw==',
					filename: 'image.png',
					mediaType: 'image/png',
				},
			],
		});
	});
});
