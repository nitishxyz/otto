import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '@ottocode/sdk/memory';
import { getDb } from '@ottocode/database';
import { sessions, messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { createUserMessage } from '../packages/server/src/runtime/message/create.ts';
import { createJudgeFromConfig } from '../packages/sdk/src/judge/index.ts';
import { memoryWriteForTurn } from '../packages/server/src/tools/memory.ts';
import {
	classifyMemoryTurn,
	memoryTurnPolicy,
	parentTaskText,
} from '../packages/server/src/runtime/agent/runner/runner-memory-policy.ts';
import {
	buildSubagentPrompt,
	buildSubagentResultsPrompt,
} from '../packages/server/src/runtime/subagents/prompt.ts';

function fixture() {
	const home = mkdtempSync(join(tmpdir(), 'otto-orchestrated-memory-'));
	const project = join(home, 'project');
	mkdirSync(project);
	const seen: Array<{
		state: Record<string, unknown>;
		questions: Record<string, unknown>;
	}> = [];
	const judge = createJudgeFromConfig(
		{
			enabled: true,
			provider: 'typesafe',
			apiKey: 'fake',
			baseURL: 'https://example.invalid',
			model: 'jev-latest',
			timeoutMs: 100,
			mcp: { classifyTools: false, preloadTools: false, preloadThreshold: 0.5 },
		},
		async (_url, init) => {
			const body = JSON.parse(String(init.body)) as {
				state: Record<string, unknown>;
				questions: Record<string, unknown>;
			};
			seen.push(body);
			const answers = Object.fromEntries(
				Object.keys(body.questions).map((id) => [
					id,
					{
						type: 'noul',
						noul:
							id === 'secret' ||
							id.startsWith('secret_') ||
							id.startsWith('duplicate_') ||
							id.startsWith('update_')
								? 0.01
								: id === 'orchestration'
									? /sub-agent|context/.test(String(body.state.statement))
										? 0.96
										: 0.08
									: id === '0' && /already/.test(String(body.state.message))
										? 0.95
										: 0.92,
					},
				]),
			);
			return Response.json({ model: 'test', answers });
		},
	);
	const path = join(home, 'memory.sqlite');
	const store = new MemoryStore(path, judge);
	return {
		home,
		project,
		path,
		store,
		seen,
		judge,
		close: () => {
			store.close();
			rmSync(home, { recursive: true, force: true });
		},
	};
}

test('delegation metadata and legacy wrappers do not become human turns', () => {
	const delegated = buildSubagentPrompt({
		parentSessionId: 'parent',
		parentAgent: 'build',
		task: 'Check the API endpoint and report.',
	});
	const results = buildSubagentResultsPrompt([
		{
			id: 'child',
			agent: 'build',
			status: 'completed',
			task: 'Check API',
			summary: 'Ready',
		},
	]);
	expect(
		classifyMemoryTurn(
			{ messageOrigin: 'parent-agent', userContent: delegated },
			'subagent',
		),
	).toBe('parent-agent');
	expect(classifyMemoryTurn({ userContent: delegated }, 'subagent')).toBe(
		'parent-agent',
	);
	expect(parentTaskText({ userContent: delegated })).toBe(
		'Check the API endpoint and report.',
	);
	expect(
		classifyMemoryTurn(
			{ messageOrigin: 'agent-results', userContent: results },
			'main',
		),
	).toBe('agent-results');
	expect(classifyMemoryTurn({ userContent: results }, 'main')).toBe(
		'agent-results',
	);
	for (const kind of ['agent-results', 'system'] as const)
		expect(memoryTurnPolicy(kind)).toMatchObject({
			recall: false,
			capture: false,
		});
	expect(memoryTurnPolicy('parent-agent')).toMatchObject({
		recall: true,
		capture: false,
	});
	expect(
		memoryTurnPolicy('parent-agent', {
			recallInSubagents: false,
			captureInSubagents: true,
		}),
	).toMatchObject({ recall: false, capture: true });
});

test('parent-agent message origin persists on the user text part', async () => {
	const f = fixture();
	try {
		const db = await getDb(f.project);
		const sessionId = crypto.randomUUID();
		await db.insert(sessions).values({
			id: sessionId,
			agent: 'build',
			provider: 'anthropic',
			model: 'claude',
			projectPath: f.project,
			createdAt: Date.now(),
			sessionType: 'subagent',
			parentSessionId: 'parent-123',
		});
		const { userMessageId } = await createUserMessage({
			db,
			sessionId,
			agent: 'build',
			provider: 'anthropic',
			model: 'claude',
			content: 'Delegated task',
			messageOrigin: 'parent-agent',
			createdAt: Date.now(),
		});
		const parts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, userMessageId));
		expect(JSON.parse(parts[0].content).messageOrigin).toBe('parent-agent');
	} finally {
		f.close();
	}
});

test('audience migration, child recall scoped to work, and redundancy guards injection', async () => {
	const f = fixture();
	try {
		const context = { projectRoot: f.project, sessionId: 'child' };
		const orchestration = await f.store.remember(
			{
				content: 'Compact sub-agent context at 250k tokens',
				scope: 'project',
				origin: 'explicit',
				source: 'user:1',
			},
			context,
		);
		expect(orchestration.memory?.audience).toBe('orchestration');
		await f.store.remember(
			{
				content: 'Use SQLite as the project database',
				scope: 'project',
				origin: 'explicit',
				source: 'user:2',
			},
			context,
		);
		const child = await f.store.recall(
			'Review SQLite and sub-agent context',
			context,
			{ audience: 'work', injection: true },
		);
		expect(
			child.memories.every((item) => item.audience !== 'orchestration'),
		).toBe(true);
		expect(child.memories.some((item) => item.content.includes('SQLite'))).toBe(
			true,
		);
		const parent = await f.store.recall('sub-agent context', context);
		expect(
			parent.memories.some((item) => item.id === orchestration.memory?.id),
		).toBe(true);
		const redundant = await f.store.recall(
			'SQLite already: Use SQLite as the project database',
			context,
			{ audience: 'work', injection: true },
		);
		expect(redundant.skipped).toContainEqual({
			id: redundant.memories[0]?.id,
			reason: 'already-in-message',
		});
		expect(redundant.injectedIds).toEqual([]);
		expect(f.store.activity().at(-1)?.injectedIds).toEqual([]);
		const db = new (await import('bun:sqlite')).Database(f.path);
		db.query('UPDATE memories SET audience = NULL WHERE id = ?').run(
			orchestration.memory?.id,
		);
		db.close();
		expect(
			f.store.graph().nodes.find((item) => item.id === orchestration.memory?.id)
				?.audience,
		).toBe('work');
	} finally {
		f.close();
	}
});

test('cosine redundancy skips retrieved memory before the three-item injection budget', async () => {
	const f = fixture();
	const store = new MemoryStore(join(f.home, 'cosine.sqlite'), null, 'otto', {
		model: 'fake:similar',
		dims: 2,
		async embed(texts) {
			return texts.map(() => new Float32Array([1, 0]));
		},
	});
	try {
		const context = { projectRoot: f.project };
		const saved = await store.remember(
			{
				content: 'Use SQLite as the project database',
				scope: 'project',
				origin: 'explicit',
				source: 'user:1',
			},
			context,
		);
		const recall = await store.recall(
			'SQLite project database already chosen',
			context,
			{ injection: true, limit: 3 },
		);
		expect(recall.skipped).toContainEqual({
			id: saved.memory?.id,
			reason: 'already-in-message',
		});
		expect(recall.injectedIds).toEqual([]);
		expect(recall.memories).toHaveLength(1);
	} finally {
		store.close();
		f.close();
	}
});

test('subagent remember relayed by parent remains inferred with parent provenance', async () => {
	const f = fixture();
	try {
		const provenance = {
			agent: 'build',
			parentSessionId: 'parent-123',
			relayedByParent: true,
		};
		const input = memoryWriteForTurn(
			{
				content: 'Use SQLite as the database',
				scope: 'project',
				source: 'parent-task',
			},
			provenance,
		);
		expect(input.origin).toBe('inferred');
		expect(input.source).toContain(
			'parentSessionId=parent-123; relayed by parent agent',
		);
		const store = new MemoryStore(
			join(f.home, 'child.sqlite'),
			f.judge,
			`otto:subagent:${provenance.agent}`,
		);
		try {
			const saved = await store.remember(input, {
				projectRoot: f.project,
				sessionId: 'child',
			});
			expect(saved.memory?.origin).toBe('inferred');
			expect(saved.memory?.agent).toBe('otto:subagent:build');
			expect(
				store.graph().nodes.find((node) => node.id === saved.memory?.id)?.source
					?.agent,
			).toBe('otto:subagent:build');
		} finally {
			store.close();
		}
	} finally {
		f.close();
	}
});

test('zero-candidate human capture still records useful activity counts', async () => {
	const f = fixture();
	try {
		const { captureUserMemory } = await import('@ottocode/sdk/memory/capture');
		expect(
			await captureUserMemory(
				f.store,
				f.judge,
				'Please review the code.',
				{ projectRoot: f.project, sessionId: 'human' },
				'user:1',
			),
		).toEqual([]);
		expect(f.store.activity().at(-1)).toMatchObject({
			type: 'capture',
			details: {
				candidates: 0,
				saved: 0,
				skipped: 0,
				reasons: ['no-candidates'],
				judge: 'typesafe',
			},
		});
		expect(
			await captureUserMemory(
				f.store,
				null,
				'I prefer concise answers.',
				{ projectRoot: f.project, sessionId: 'human' },
				'user:2',
			),
		).toEqual([]);
		expect(f.store.activity().at(-1)).toMatchObject({
			type: 'capture',
			details: {
				candidates: 1,
				saved: 0,
				skipped: 1,
				reasons: ['no-judge'],
				judge: 'unavailable',
			},
		});
	} finally {
		f.close();
	}
});
