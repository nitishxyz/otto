import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	MemoryStore,
	type MemoryResult,
	type Memory,
} from '@ottocode/sdk/memory';
import { createJudgeFromConfig } from '../packages/sdk/src/judge/index.ts';

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'otto-graph-'));
	const project = join(root, 'project');
	const other = join(root, 'other');
	mkdirSync(project);
	mkdirSync(other);
	const store = new MemoryStore(join(root, 'memory.sqlite'));
	return {
		store,
		root,
		project,
		other,
		close: () => {
			store.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

const explicit = (content: string, replacesId?: string) => ({
	content,
	scope: 'project' as const,
	origin: 'explicit' as const,
	source: 'user:1',
	replacesId,
});
function required(result: MemoryResult): Memory {
	if (!result.memory) throw new Error('Expected a memory');
	return result.memory;
}

test('supersession chain prefers current head and provides lineage plus provenance', async () => {
	const f = fixture();
	try {
		const context = { projectRoot: f.project };
		const a = required(
			await f.store.remember(explicit('Editor preference Vim'), context),
		);
		const b = required(
			await f.store.remember(
				explicit('Editor preference Helix', a.id),
				context,
			),
		);
		const c = required(
			await f.store.remember(explicit('Editor preference Zed', b.id), context),
		);
		expect(
			(await f.store.recall('Vim', context)).memories.map((row) => row.id),
		).toEqual([c.id]);
		const lineage = f.store.lineage(a.id, context);
		expect(lineage?.head.id).toBe(c.id);
		expect(lineage?.timeline.map((item) => item.content)).toEqual([
			a.content,
			b.content,
			c.content,
		]);
		expect(
			lineage?.edges.filter((edge) => edge.type === 'supersedes'),
		).toHaveLength(2);
		expect(
			lineage?.edges.some(
				(edge) => edge.type === 'derived_from' && edge.origin === 'code',
			),
		).toBe(true);
		expect(f.store.lineage(a.id, { projectRoot: f.other })).toBeNull();
		expect(
			(
				await f.store.remember(
					explicit('Editor preference Emacs', a.id),
					context,
				)
			).status,
		).toBe('rejected');
	} finally {
		f.close();
	}
});

test('forget deletes incident graph edges and removes forgotten node from timeline', async () => {
	const f = fixture();
	try {
		const ctx = { projectRoot: f.project };
		const a = required(
			await f.store.remember(explicit('Editor preference Vim'), ctx),
		);
		const b = required(
			await f.store.remember(explicit('Editor preference Helix', a.id), ctx),
		);
		expect(f.store.forget(a.id, ctx)).toBe(true);
		expect(f.store.lineage(a.id, ctx)).toBeNull();
		expect(
			f.store.lineage(b.id, ctx)?.edges.some((edge) => edge.toId === a.id),
		).toBe(false);
		const db = new (await import('bun:sqlite')).Database(
			join(f.root, 'memory.sqlite'),
		);
		expect(
			db
				.query('SELECT * FROM memory_edges WHERE from_id = ? OR to_id = ?')
				.all(a.id, a.id),
		).toHaveLength(0);
		db.close();
	} finally {
		f.close();
	}
});

test('about expansion is bounded and never crosses project boundaries', async () => {
	const f = fixture();
	try {
		const ctx = { projectRoot: f.project };
		await f.store.remember(explicit('SQLite migration strategy'), ctx);
		await f.store.remember(explicit('SQLite schema validation'), ctx);
		await f.store.remember(explicit('SQLite query performance'), ctx);
		await f.store.remember(explicit('SQLite secret in other repository'), {
			projectRoot: f.other,
		});
		const results = (await f.store.recall('migration', ctx, { limit: 2 }))
			.memories;
		expect(results).toHaveLength(2);
		expect(
			results.every((row) => !row.content.includes('other repository')),
		).toBe(true);
		expect(
			results.some(
				(row) =>
					row.content.includes('schema') || row.content.includes('performance'),
			),
		).toBe(true);
	} finally {
		f.close();
	}
});

test('high-confidence TypeSafe contradiction is linked but does not supersede', async () => {
	const f = fixture();
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
			const body = JSON.parse(String(init.body));
			return Response.json({
				model: 'test',
				answers: Object.fromEntries(
					Object.keys(body.questions).map((id) => [
						id,
						{ type: 'noul', noul: id.startsWith('contradicts_') ? 0.98 : 0.01 },
					]),
				),
			});
		},
	);
	const store = new MemoryStore(join(f.root, 'judged.sqlite'), judge);
	try {
		const ctx = { projectRoot: f.project };
		const old = required(
			await store.remember(explicit('SQLite engine selected'), ctx),
		);
		const newer = required(
			await store.remember(explicit('SQLite engine rejected'), ctx),
		);
		const edge = store
			.lineage(newer.id, ctx)
			?.edges.find(
				(item) => item.toId === old.id && item.type === 'contradicts',
			);
		expect(edge?.origin).toBe('typesafe');
		expect(edge?.score).toBe(0.98);
		expect(store.lineage(old.id, ctx)?.head.id).toBe(old.id);
	} finally {
		store.close();
		f.close();
	}
});

test('uncertain contradictions remain separate without supersession', async () => {
	const root = mkdtempSync(join(tmpdir(), 'otto-graph-judge-'));
	mkdirSync(join(root, 'project'));
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
			const body = JSON.parse(String(init.body));
			return Response.json({
				model: 'test',
				answers: Object.fromEntries(
					Object.keys(body.questions).map((id) => [
						id,
						{ type: 'noul', noul: id.startsWith('contradicts_') ? 0.6 : 0.1 },
					]),
				),
			});
		},
	);
	const store = new MemoryStore(join(root, 'memory.sqlite'), judge);
	try {
		const ctx = { projectRoot: join(root, 'project') };
		const a = required(
			await store.remember(explicit('SQLite engine selected'), ctx),
		);
		const b = required(
			await store.remember(explicit('SQLite engine rejected'), ctx),
		);
		expect(store.lineage(a.id, ctx)?.head.id).toBe(a.id);
		expect(
			store
				.lineage(b.id, ctx)
				?.edges.filter(
					(edge) => edge.type === 'supersedes' || edge.type === 'contradicts',
				),
		).toHaveLength(0);
	} finally {
		store.close();
		rmSync(root, { recursive: true, force: true });
	}
});
