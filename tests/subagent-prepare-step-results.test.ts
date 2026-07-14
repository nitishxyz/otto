import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, type DB } from '@ottocode/database';
import {
	messageParts,
	messages,
	sessions,
	subagents,
} from '@ottocode/database/schema';
import { asc, eq } from 'drizzle-orm';
import type { ModelMessage } from 'ai';
import { withSubagentResultsPrepareStep } from '../packages/server/src/runtime/agent/runner/runner-subagent-results.ts';
import { buildHistoryMessages } from '../packages/server/src/runtime/message/history-builder.ts';
import type { ToolAdapterContext } from '../packages/server/src/runtime/tools/context.ts';

const PARENT_SESSION_ID = 'parent-session';
const ASSISTANT_MESSAGE_ID = 'assistant-message';

let db: DB;
let projectRoot = '';
let nextPartIndex = 0;

function createContext(): ToolAdapterContext {
	return {
		sessionId: PARENT_SESSION_ID,
		messageId: ASSISTANT_MESSAGE_ID,
		assistantPartId: '',
		db,
		agent: 'build',
		provider: 'anthropic',
		model: 'test-model',
		projectRoot,
		nextIndex: () => nextPartIndex++,
	};
}

async function insertSubagent(args: {
	id: string;
	status: 'running' | 'completed' | 'failed';
	summary: string | null;
	createdAt: number;
}) {
	await db.insert(subagents).values({
		id: args.id,
		parentSessionId: PARENT_SESSION_ID,
		childSessionId: `child-${args.id}`,
		agent: 'general',
		task: `Task for ${args.id}`,
		status: args.status,
		summary: args.summary,
		reported: false,
		createdAt: args.createdAt,
		updatedAt: args.createdAt,
	});
}

beforeEach(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-subagent-prepare-step-'));
	db = await getDb(projectRoot);
	nextPartIndex = 0;
	const now = Date.now();
	await db.insert(sessions).values({
		id: PARENT_SESSION_ID,
		agent: 'build',
		provider: 'anthropic',
		model: 'test-model',
		projectPath: projectRoot,
		createdAt: now,
		sessionType: 'main',
	});
	await db.insert(messages).values({
		id: ASSISTANT_MESSAGE_ID,
		sessionId: PARENT_SESSION_ID,
		role: 'assistant',
		status: 'pending',
		agent: 'build',
		provider: 'anthropic',
		model: 'test-model',
		createdAt: now,
	});
});

afterEach(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('withSubagentResultsPrepareStep', () => {
	test('persists and injects finished results exactly once', async () => {
		const now = Date.now();
		await insertSubagent({
			id: 'result-a',
			status: 'completed',
			summary: 'Changed the requested files.',
			createdAt: now,
		});
		await insertSubagent({
			id: 'result-b',
			status: 'failed',
			summary: 'The verification command failed.',
			createdAt: now + 1,
		});

		const baseMessages: ModelMessage[] = [
			{ role: 'user', content: 'Continue the parent task.' },
		];
		const prepareStep = withSubagentResultsPrepareStep(undefined, {
			db,
			ctx: createContext(),
		});
		const first = await prepareStep({
			stepNumber: 3,
			steps: [],
			messages: baseMessages,
		});

		expect(first?.messages).toHaveLength(3);
		const injected = JSON.stringify(first?.messages);
		expect(injected).toContain('subagent_result');
		expect(injected).toContain('result-a');
		expect(injected).toContain('Changed the requested files.');
		expect(injected).toContain('result-b');
		expect(injected).toContain('The verification command failed.');

		const parts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, ASSISTANT_MESSAGE_ID))
			.orderBy(asc(messageParts.index));
		expect(parts.map((part) => part.type)).toEqual([
			'tool_call',
			'tool_result',
		]);
		expect(parts.map((part) => part.index)).toEqual([0, 1]);
		expect(parts.every((part) => part.stepIndex === 3)).toBe(true);
		expect(parts[0]?.toolName).toBe('subagent_result');
		expect(parts[0]?.toolCallId).toBe(parts[1]?.toolCallId);

		const records = await db
			.select()
			.from(subagents)
			.where(eq(subagents.parentSessionId, PARENT_SESSION_ID));
		expect(records.every((record) => record.reported)).toBe(true);

		const laterMessages: ModelMessage[] = [
			...baseMessages,
			{ role: 'assistant', content: 'Used the injected result.' },
		];
		const second = await prepareStep({
			stepNumber: 4,
			steps: [],
			messages: laterMessages,
		});
		expect(second?.messages).toHaveLength(4);
		expect(second?.messages?.map((message) => message.role)).toEqual([
			'user',
			'assistant',
			'tool',
			'assistant',
		]);
		expect(second?.messages?.at(-1)).toEqual(laterMessages.at(-1));
		const persistedAgain = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, ASSISTANT_MESSAGE_ID));
		expect(persistedAgain).toHaveLength(2);
	});

	test('preserves inner messages and durable history ordering', async () => {
		await insertSubagent({
			id: 'result-a',
			status: 'completed',
			summary: 'Research is complete.',
			createdAt: Date.now(),
		});
		const innerMessages: ModelMessage[] = [
			{ role: 'user', content: 'Original request' },
			{ role: 'user', content: 'Inner prepareStep reminder' },
		];
		const prepareStep = withSubagentResultsPrepareStep(
			() => ({ activeTools: ['read'], messages: innerMessages }),
			{ db, ctx: createContext() },
		);
		const result = await prepareStep({
			stepNumber: 1,
			steps: [],
			messages: [{ role: 'user', content: 'Original request' }],
		});

		expect(result?.activeTools).toEqual(['read']);
		expect(result?.messages?.slice(0, 2)).toEqual(innerMessages);

		await db
			.update(messages)
			.set({ status: 'complete', completedAt: Date.now() })
			.where(eq(messages.id, ASSISTANT_MESSAGE_ID));
		const history = await buildHistoryMessages(db, PARENT_SESSION_ID);
		const serializedHistory = JSON.stringify(history);
		expect(serializedHistory).toContain('subagent_result');
		expect(serializedHistory).toContain('Research is complete.');
	});

	test('leaves running results for the idle fallback', async () => {
		await insertSubagent({
			id: 'still-running',
			status: 'running',
			summary: null,
			createdAt: Date.now(),
		});
		const prepareStep = withSubagentResultsPrepareStep(undefined, {
			db,
			ctx: createContext(),
		});
		const result = await prepareStep({
			stepNumber: 2,
			steps: [],
			messages: [{ role: 'user', content: 'Continue.' }],
		});

		expect(result).toBeUndefined();
		const records = await db.select().from(subagents);
		expect(records[0]?.reported).toBe(false);
		const parts = await db.select().from(messageParts);
		expect(parts).toHaveLength(0);
	});
});
