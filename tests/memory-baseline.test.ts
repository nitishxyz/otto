import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, type Memory } from '@ottocode/sdk/memory';
import {
	BASELINE_JUDGE_CONTENT_CHARS,
	BASELINE_JUDGE_TASK_CHARS,
	BASELINE_SHORTLIST_LIMIT,
	selectBaseline,
} from '../packages/sdk/src/memory/baseline.ts';
import { createJudgeFromConfig } from '../packages/sdk/src/judge/index.ts';
import { loadTurnMemories } from '../packages/server/src/runtime/agent/runner/runner-memory-load.ts';

type BaselineState = {
	role: string;
	task: string;
	memories: Array<{ content: string; scope: string; audience: string }>;
};

/** Mock TypeSafe: baseline questions score ESSENTIAL highly and trivia low; write-time checks are benign. */
function mockJudge(options: { failBaseline?: boolean } = {}) {
	const baselineCalls: BaselineState[] = [];
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
			const isBaseline = Object.keys(body.questions).some((id) =>
				id.startsWith('baseline_'),
			);
			if (isBaseline) {
				baselineCalls.push(body.state as BaselineState);
				if (options.failBaseline)
					return new Response('unavailable', { status: 503 });
			}
			const memories = (body.state as BaselineState).memories ?? [];
			return Response.json({
				model: 'test',
				answers: Object.fromEntries(
					Object.keys(body.questions).map((id) => {
						let noul = 0.01;
						if (id.startsWith('baseline_')) {
							const content = memories[Number(id.slice(9))]?.content ?? '';
							noul = /ESSENTIAL/.test(content)
								? 0.95
								: /trivia/.test(content)
									? 0.05
									: 0.5;
						}
						return [id, { type: 'noul', noul }];
					}),
				),
			});
		},
	);
	if (!judge) throw new Error('judge');
	return { judge, baselineCalls };
}

function fixture(judge: ReturnType<typeof mockJudge>['judge'] | null) {
	const root = mkdtempSync(join(tmpdir(), 'otto-memory-baseline-'));
	const project = join(root, 'project');
	const other = join(root, 'other');
	mkdirSync(project);
	mkdirSync(other);
	const store = new MemoryStore(join(root, 'memory.sqlite'), judge);
	return {
		project,
		other,
		store,
		close: () => {
			store.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

const core = (
	content: string,
	scope: Memory['scope'] = 'project',
	audience: Memory['audience'] = 'work',
) => ({
	content,
	scope,
	origin: 'explicit' as const,
	source: 'user:1',
	priority: 'core' as const,
	audience: audience ?? 'work',
});

const memory = (
	id: string,
	content: string,
	extra: Partial<Memory> = {},
): Memory => ({
	id,
	content,
	scope: 'project',
	origin: 'explicit',
	source: 'user',
	priority: 'core',
	audience: 'work',
	createdAt: 0,
	updatedAt: 0,
	...extra,
});

test('judged baseline keeps essential standing preferences for an unrelated task over recent trivia', async () => {
	const { judge, baselineCalls } = mockJudge();
	const f = fixture(judge);
	try {
		const ctx = { projectRoot: f.project, sessionId: 'main' };
		const essential = await f.store.remember(
			core(
				'ESSENTIAL: compact sub-agent context at 250k tokens, not 60-80k',
				'global',
				'orchestration',
			),
			ctx,
		);
		const convention = await f.store.remember(
			core('ESSENTIAL: run bun lint and focused tests before finishing'),
			ctx,
		);
		for (let i = 0; i < 6; i++)
			await f.store.remember(
				core(`Project trivia note ${i}: ${'detail '.repeat(60)}`),
				ctx,
			);
		const task = 'Change the settings button colour to blue';
		const selection = await f.store.baseline(ctx, {
			task,
			tokenBudget: 200,
		});
		expect(selection.ranking).toBe('typesafe');
		expect(selection.memories.map((item) => item.id).sort()).toEqual(
			[essential.memory?.id, convention.memory?.id].sort(),
		);
		expect(selection.tokens).toBeLessThanOrEqual(200);
		expect(selection.overflow).toHaveLength(6);
		expect(selection.overflow.every((item) => item.reason === 'budget')).toBe(
			true,
		);
		// One batched judgment over the bounded shortlist, with role, metadata and the task.
		expect(baselineCalls).toHaveLength(1);
		expect(baselineCalls[0]?.task).toBe(task);
		expect(baselineCalls[0]?.role).toContain('main agent');
		expect(baselineCalls[0]?.memories).toHaveLength(8);
		expect(baselineCalls[0]?.memories[0]).toHaveProperty('scope');
		// The deterministic order (most recent first) would have chosen trivia instead.
		const deterministic = f.store.core(ctx, { tokenBudget: 200 });
		expect(deterministic.map((item) => item.id)).not.toContain(
			essential.memory?.id,
		);
		// Overflow is visible in activity, not silent.
		expect(f.store.activity().at(-2)?.details).toMatchObject({
			priority: 'core',
			ranking: 'typesafe',
			overflow: 6,
		});
	} finally {
		f.close();
	}
});

test('project, session and audience isolation happen before anything reaches the judge', async () => {
	const { judge, baselineCalls } = mockJudge();
	const f = fixture(judge);
	try {
		const ctx = { projectRoot: f.project, sessionId: 'child' };
		await f.store.remember(core('Other project secret plan'), {
			projectRoot: f.other,
		});
		await f.store.remember(core('Other session rule', 'session'), {
			projectRoot: f.project,
			sessionId: 'someone-else',
		});
		await f.store.remember(
			core('ESSENTIAL: track sub-agent context', 'global', 'orchestration'),
			ctx,
		);
		const old = await f.store.remember(
			core(`Old rule ${'x '.repeat(200)}`),
			ctx,
		);
		await f.store.remember(
			{ ...core(`New rule ${'y '.repeat(200)}`), replacesId: old.memory?.id },
			ctx,
		);
		for (let i = 0; i < 4; i++)
			await f.store.remember(core(`Work trivia ${i} ${'z '.repeat(250)}`), ctx);
		const selection = await f.store.baseline(ctx, {
			audience: 'work',
			task: 'Review the API',
		});
		expect(baselineCalls).toHaveLength(1);
		const sent = baselineCalls[0]?.memories.map((item) => item.content) ?? [];
		expect(baselineCalls[0]?.role).toContain('sub-agent');
		expect(sent.some((text) => text.includes('Other'))).toBe(false);
		expect(sent.some((text) => text.includes('sub-agent context'))).toBe(false);
		expect(sent.some((text) => text.startsWith('Old rule'))).toBe(false);
		expect(
			sent.every((text) => text.length <= BASELINE_JUDGE_CONTENT_CHARS),
		).toBe(true);
		const ids = [
			...selection.memories.map((item) => item.id),
			...selection.overflow.map((item) => item.id),
		];
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).not.toContain(old.memory?.id);
	} finally {
		f.close();
	}
});

test('shortlist is bounded, protects scope coverage, and reports what was not judged', async () => {
	const { judge, baselineCalls } = mockJudge();
	const rows = [
		...Array.from({ length: 3 }, (_, i) =>
			memory(`s${i}`, `Session rule ${i}`, { scope: 'session' }),
		),
		...Array.from({ length: 30 }, (_, i) =>
			memory(`p${i}`, `Project rule ${i}`, { updatedAt: 100 + i }),
		),
		...Array.from({ length: 5 }, (_, i) =>
			memory(`g${i}`, `Global rule ${i}`, { scope: 'global' }),
		),
	];
	const selection = await selectBaseline(rows, {
		judge,
		task: 't'.repeat(5000),
		tokenBudget: 100,
	});
	const sent = baselineCalls[0];
	expect(sent?.memories).toHaveLength(BASELINE_SHORTLIST_LIMIT);
	expect(sent?.task.length).toBe(BASELINE_JUDGE_TASK_CHARS);
	expect(new Set(sent?.memories.map((item) => item.scope))).toEqual(
		new Set(['session', 'project', 'global']),
	);
	expect(
		sent?.memories.filter((item) => item.scope === 'session'),
	).toHaveLength(3);
	expect(sent?.memories.filter((item) => item.scope === 'global')).toHaveLength(
		5,
	);
	expect(
		selection.overflow.filter((item) => item.reason === 'shortlist'),
	).toHaveLength(rows.length - BASELINE_SHORTLIST_LIMIT);
	expect(selection.memories.length + selection.overflow.length).toBe(
		rows.length,
	);
});

test('absent or failing judge falls back deterministically; all-fit skips the judge', async () => {
	const rows = [
		memory('inferred', 'Inferred rule', { origin: 'inferred', updatedAt: 9 }),
		memory('explicit-old', 'Explicit rule old', { updatedAt: 1 }),
		memory('explicit-new', 'Explicit rule new', { updatedAt: 5 }),
	];
	const none = await selectBaseline(rows, { judge: null, tokenBudget: 50 });
	expect(none.ranking).toBe('deterministic');
	expect(none.memories.map((item) => item.id)).toEqual(['explicit-new']);
	expect(none.overflow).toEqual([
		{ id: 'explicit-old', reason: 'budget' },
		{ id: 'inferred', reason: 'budget' },
	]);
	const failing = mockJudge({ failBaseline: true });
	const failed = await selectBaseline(rows, {
		judge: failing.judge,
		tokenBudget: 50,
	});
	expect(failing.baselineCalls).toHaveLength(1);
	expect(failed.ranking).toBe('deterministic');
	expect(failed.memories.map((item) => item.id)).toEqual(['explicit-new']);
	const ok = mockJudge();
	const fits = await selectBaseline(rows, { judge: ok.judge });
	expect(fits.ranking).toBe('all-fit');
	expect(fits.memories).toHaveLength(3);
	expect(ok.baselineCalls).toHaveLength(0);
});

test('judge may set aside inferred trivia as not applicable but never drops explicit user core', async () => {
	const { judge } = mockJudge();
	const rows = [
		memory('explicit-trivia', 'Explicit trivia rule'),
		memory('inferred-trivia', 'Inferred trivia rule', { origin: 'inferred' }),
		memory('essential', 'ESSENTIAL rule'),
		memory('filler', `Filler ${'f '.repeat(300)}`),
	];
	const selection = await selectBaseline(rows, { judge, tokenBudget: 100 });
	expect(selection.ranking).toBe('typesafe');
	expect(selection.memories.map((item) => item.id)).toEqual([
		'essential',
		'explicit-trivia',
	]);
	expect(selection.overflow).toContainEqual({
		id: 'inferred-trivia',
		reason: 'not-applicable',
	});
	expect(selection.overflow).toContainEqual({ id: 'filler', reason: 'budget' });
});

test('turn loading reports overflow, never repeats core, and overflowed core stays recallable', async () => {
	const f = fixture(null);
	try {
		const ctx = { projectRoot: f.project, sessionId: 'main' };
		const big = await f.store.remember(
			core(`Kubernetes deployment convention A ${'k '.repeat(900)}`),
			ctx,
		);
		await Bun.sleep(2);
		const big2 = await f.store.remember(
			core(`Kubernetes deployment convention B ${'k '.repeat(900)}`),
			ctx,
		);
		await Bun.sleep(2);
		const small = await f.store.remember(
			core('Prefer small focused diffs'),
			ctx,
		);
		const loaded = await loadTurnMemories(f.store, {
			query: 'Kubernetes deployment',
			context: ctx,
			core: true,
			recall: true,
		});
		expect(loaded.recall?.coreIds).toEqual([
			small.memory?.id ?? '',
			big2.memory?.id ?? '',
		]);
		expect(loaded.recall?.core?.tokens).toBeLessThanOrEqual(800);
		expect(loaded.recall?.core?.overflow).toEqual([
			{ id: big.memory?.id ?? '', reason: 'budget' },
		]);
		// The overflowed core memory is still found on demand by contextual recall, once.
		expect(
			loaded.recall?.injectedIds.filter((id) => id === big.memory?.id),
		).toHaveLength(1);
		expect(new Set(loaded.recall?.injectedIds).size).toBe(
			loaded.recall?.injectedIds.length,
		);
		const unrelated = await loadTurnMemories(f.store, {
			query: 'Rename a variable',
			context: ctx,
			core: true,
			recall: true,
		});
		expect(unrelated.message).toContain('1 more saved core preference');
		expect(unrelated.message).toContain('recall_memory');
	} finally {
		f.close();
	}
});

test('ordinary duplicates return duplicate; an invalid replacesId is rejected', async () => {
	const f = fixture(null);
	try {
		const ctx = { projectRoot: f.project };
		const first = await f.store.remember(core('Use tabs'), ctx);
		const again = await f.store.remember(core('Use tabs'), ctx);
		expect(again).toMatchObject({
			status: 'duplicate',
			memory: { id: first.memory?.id },
		});
		const plain = await f.store.remember(
			{
				content: 'use TABS',
				scope: 'project',
				origin: 'explicit',
				source: 'u',
			},
			ctx,
		);
		expect(plain.status).toBe('duplicate');
		const invalid = await f.store.remember(
			{ ...core('Use tabs'), replacesId: crypto.randomUUID() },
			ctx,
		);
		expect(invalid).toMatchObject({
			status: 'rejected',
			reason: 'Replacement is not accessible in this scope',
		});
	} finally {
		f.close();
	}
});
