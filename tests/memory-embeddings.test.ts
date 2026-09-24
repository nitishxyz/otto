import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore, secretPattern } from '@ottocode/sdk/memory';
import type { Embedder } from '@ottocode/sdk/memory/embedder';
import { createJudgeFromConfig } from '../packages/sdk/src/judge/index.ts';
import {
	createLocalEmbedder,
	localModelReady,
} from '../packages/sdk/src/memory/local-embedder.ts';

const embedder: Embedder = {
	model: 'test:paraphrase',
	dims: 2,
	async embed(texts) {
		return texts.map((text) =>
			/retrieve|remember|concise|brief|short/i.test(text)
				? new Float32Array([1, 0])
				: new Float32Array([0, 1]),
		);
	},
};

function fixture(judge = false) {
	const root = mkdtempSync(join(tmpdir(), 'otto-vector-'));
	const a = join(root, 'a');
	const b = join(root, 'b');
	mkdirSync(a);
	mkdirSync(b);
	const api = judge
		? createJudgeFromConfig(
				{
					enabled: true,
					provider: 'typesafe',
					apiKey: 'fake',
					baseURL: 'https://example.invalid',
					model: 'jev-latest',
					timeoutMs: 100,
					mcp: {
						classifyTools: false,
						preloadTools: false,
						preloadThreshold: 0.5,
					},
				},
				async (_url, init) => {
					const request = JSON.parse(String(init.body)) as {
						questions: Record<string, unknown>;
					};
					return Response.json({
						model: 'fake',
						answers: Object.fromEntries(
							Object.keys(request.questions).map((id) => [
								id,
								{
									type: 'noul',
									noul:
										id === 'secret'
											? 0.01
											: id.startsWith('duplicate_')
												? 0.95
												: id.startsWith('update_')
													? 0.01
													: 0.95,
								},
							]),
						),
					});
				},
			)
		: null;
	const path = join(root, 'memory.sqlite');
	const store = new MemoryStore(path, api, 'otto', embedder);
	return {
		root,
		a,
		b,
		path,
		store,
		close: () => {
			store.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

test('semantic neighbor finds paraphrase without FTS overlap and filters projects', async () => {
	const f = fixture();
	try {
		await f.store.remember(
			{
				content: 'Use concise responses',
				scope: 'project',
				origin: 'explicit',
				source: 'user',
			},
			{ projectRoot: f.a },
		);
		const result = await f.store.recall('retrieve short answers', {
			projectRoot: f.a,
		});
		expect(result.ranking).toBe('vector');
		expect(result.memories[0]?.content).toBe('Use concise responses');
		expect(
			(await f.store.recall('retrieve short answers', { projectRoot: f.b }))
				.memories,
		).toHaveLength(0);
	} finally {
		f.close();
	}
});

test('semantic duplicate, forget vector, and idempotent backfill', async () => {
	const f = fixture(true);
	try {
		const ctx = { projectRoot: f.a };
		const first = await f.store.remember(
			{
				content: 'Prefer concise explanations',
				scope: 'project',
				origin: 'explicit',
				source: 'user',
			},
			ctx,
		);
		expect(
			(
				await f.store.remember(
					{
						content: 'Remember short answers',
						scope: 'project',
						origin: 'explicit',
						source: 'user',
					},
					ctx,
				)
			).status,
		).toBe('duplicate');
		expect(await f.store.reindex()).toBe(0);
		const db = new Database(f.path);
		if (!first.memory) throw new Error('missing memory');
		db.query('DELETE FROM memory_embeddings WHERE memory_id = ?').run(
			first.memory.id,
		);
		expect(await f.store.reindex()).toBe(1);
		expect(await f.store.reindex()).toBe(0);
		f.store.forget(first.memory.id, ctx);
		expect(
			db
				.query('SELECT * FROM memory_embeddings WHERE memory_id = ?')
				.all(first.memory.id),
		).toHaveLength(0);
		db.close();
	} finally {
		f.close();
	}
});

test('Jev secret judgment blocks an otherwise unrecognized credential', async () => {
	const f = fixture(true);
	try {
		const judge = createJudgeFromConfig(
			{
				enabled: true,
				provider: 'typesafe',
				apiKey: 'fake',
				baseURL: 'https://example.invalid',
				model: 'jev-latest',
				timeoutMs: 100,
				mcp: {
					classifyTools: false,
					preloadTools: false,
					preloadThreshold: 0.5,
				},
			},
			async (_url, init) => {
				const request = JSON.parse(String(init.body)) as {
					questions: Record<string, unknown>;
				};
				return Response.json({
					model: 'test',
					answers: Object.fromEntries(
						Object.keys(request.questions).map((id) => [
							id,
							{ type: 'noul', noul: id === 'secret' ? 0.99 : 0.01 },
						]),
					),
				});
			},
		);
		const store = new MemoryStore(join(f.root, 'secret.sqlite'), judge);
		try {
			expect(
				(
					await store.remember(
						{
							content: 'custom credential alpha omega',
							scope: 'project',
							origin: 'explicit',
							source: 'user',
						},
						{ projectRoot: f.a },
					)
				).status,
			).toBe('rejected');
		} finally {
			store.close();
		}
	} finally {
		f.close();
	}
});

test.skipIf(!localModelReady())(
	'cached local ONNX WASM embeds text without network',
	async () => {
		const vectors = await createLocalEmbedder().embed(['a concise answer']);
		expect(vectors[0]?.length).toBe(384);
		expect(vectors[0]?.every(Number.isFinite)).toBe(true);
	},
	60_000,
);

test('reindex warms an empty store using the configured embedder', async () => {
	let calls = 0;
	const root = mkdtempSync(join(tmpdir(), 'otto-vector-warm-'));
	const store = new MemoryStore(join(root, 'memory.sqlite'), null, 'otto', {
		model: 'fake:warm',
		dims: 2,
		async embed(texts) {
			calls++;
			return texts.map(() => new Float32Array([1, 0]));
		},
	});
	try {
		expect(await store.reindex()).toBe(0);
		expect(calls).toBe(1);
	} finally {
		store.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test('credential prefixes and URIs are screened deterministically', () => {
	for (const value of [
		'sk-abcdefghijklmnopqrstuvwxyz1234',
		'ghp_abcdefghijklmnopqrstuvwxyz1234',
		'AKIAABCDEFGHIJKLMNOP',
		'xoxb-12345678901234567890',
		'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdef123',
		'-----BEGIN PRIVATE KEY-----',
		'postgres://user:pass@localhost/db',
	]) {
		expect(secretPattern.test(value)).toBe(true);
	}
});
