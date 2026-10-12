import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import {
	finalizeOpenReasoningStates,
	handleReasoningDelta,
	handleReasoningEnd,
	handleReasoningStart,
	type ReasoningState,
} from '../packages/server/src/runtime/agent/runner/runner-reasoning.ts';
import { flushPartContentWrites } from '../packages/server/src/runtime/persistence/part-content-writer.ts';
import type { RunOpts } from '../packages/server/src/runtime/session/queue.ts';

let projectRoot = '';

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-harness-reasoning-'));
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

async function setup() {
	const db = await getDb(projectRoot);
	const sessionId = crypto.randomUUID();
	const messageId = crypto.randomUUID();
	await db.insert(sessions).values({
		id: sessionId,
		agent: 'build',
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		projectPath: projectRoot,
		createdAt: Date.now(),
	});
	await db.insert(messages).values({
		id: messageId,
		sessionId,
		role: 'assistant',
		status: 'pending',
		agent: 'build',
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		createdAt: Date.now(),
	});
	const opts: RunOpts = {
		sessionId,
		assistantMessageId: messageId,
		agent: 'build',
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		projectRoot,
	};
	let index = 0;
	const sharedCtx = {
		sessionId,
		messageId,
		projectRoot,
		nextIndex: () => index++,
	} as never;
	return { db, opts, sharedCtx };
}

async function readReasoning(
	db: Awaited<ReturnType<typeof getDb>>,
	messageId: string,
) {
	await flushPartContentWrites();
	return db
		.select()
		.from(messageParts)
		.where(eq(messageParts.messageId, messageId));
}

describe('reasoning persistence', () => {
	test('metadata-only deltas and end metadata are persisted', async () => {
		const { db, opts, sharedCtx } = await setup();
		const states = new Map<string, ReasoningState>();
		await handleReasoningStart(
			'r1',
			undefined,
			opts,
			db,
			sharedCtx,
			() => 0,
			states,
		);
		await handleReasoningDelta(
			'r1',
			'thinking',
			undefined,
			opts,
			db,
			sharedCtx,
			() => 0,
			states,
		);
		await handleReasoningDelta(
			'r1',
			'',
			{ anthropic: { signature: 'sig-1' } },
			opts,
			db,
			sharedCtx,
			() => 0,
			states,
		);
		let [part] = await readReasoning(db, opts.assistantMessageId);
		expect(JSON.parse(part.content ?? '{}').providerMetadata).toEqual({
			anthropic: { signature: 'sig-1' },
		});

		await handleReasoningEnd('r1', db, states, {
			anthropic: { redactedData: 'x' },
		});
		[part] = await readReasoning(db, opts.assistantMessageId);
		expect(JSON.parse(part.content ?? '{}')).toEqual({
			text: 'thinking',
			providerMetadata: {
				anthropic: { signature: 'sig-1', redactedData: 'x' },
			},
		});
		expect(part.completedAt).not.toBeNull();
		expect(states.size).toBe(0);
	});

	test('open reasoning states are finalized on abnormal termination', async () => {
		const { db, opts, sharedCtx } = await setup();
		const states = new Map<string, ReasoningState>();
		await handleReasoningStart(
			'open',
			undefined,
			opts,
			db,
			sharedCtx,
			() => 0,
			states,
		);
		await handleReasoningDelta(
			'open',
			'partial',
			undefined,
			opts,
			db,
			sharedCtx,
			() => 0,
			states,
		);
		await handleReasoningStart(
			'empty',
			undefined,
			opts,
			db,
			sharedCtx,
			() => 0,
			states,
		);

		await finalizeOpenReasoningStates(db, states);
		const parts = await readReasoning(db, opts.assistantMessageId);
		expect(states.size).toBe(0);
		expect(parts).toHaveLength(1);
		expect(JSON.parse(parts[0].content ?? '{}').text).toBe('partial');
		expect(parts[0].completedAt).not.toBeNull();
	});
});
