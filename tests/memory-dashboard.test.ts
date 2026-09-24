import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '@ottocode/sdk/memory';
import { createMemoryDashboardApp } from '../packages/server/src/memory-dashboard.ts';

test('existing memories migrate agent column without losing rows', async () => {
	const root = mkdtempSync(join(tmpdir(), 'otto-memory-legacy-'));
	const path = join(root, 'memory.sqlite');
	const { Database } = await import('bun:sqlite');
	const legacy = new Database(path);
	legacy.exec(
		'CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, scope TEXT NOT NULL, scope_key TEXT NOT NULL, origin TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
	);
	legacy
		.query('INSERT INTO memories VALUES (?,?,?,?,?,?,?,?)')
		.run(
			crypto.randomUUID(),
			'Legacy fact',
			'global',
			'',
			'explicit',
			'user',
			1,
			1,
		);
	legacy.close();
	try {
		const store = new MemoryStore(path);
		try {
			const row = store
				.graph()
				.nodes.find((node) => node.content === 'Legacy fact');
			expect(row?.source?.agent).toBe('otto');
			expect(
				(
					await store.remember(
						{
							content: 'Modern fact',
							origin: 'explicit',
							scope: 'global',
							source: 'user',
						},
						{ projectRoot: root },
					)
				).memory?.agent,
			).toBe('otto');
		} finally {
			store.close();
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('dashboard graph, lineage, scope, search and cross-store activity', async () => {
	const root = mkdtempSync(join(tmpdir(), 'otto-dashboard-'));
	const project = join(root, 'project');
	const other = join(root, 'other');
	mkdirSync(project);
	mkdirSync(other);
	const path = join(root, 'memory.sqlite');
	const writer = new MemoryStore(path);
	const reader = new MemoryStore(path);
	const app = createMemoryDashboardApp(path);
	try {
		const original = await writer.remember(
			{
				content: 'SQLite first version',
				scope: 'project',
				origin: 'explicit',
				source: 'user:one',
			},
			{ projectRoot: project },
		);
		const updated = await writer.remember(
			{
				content: 'SQLite second version',
				scope: 'project',
				origin: 'explicit',
				source: 'user:two',
				replacesId: original.memory?.id,
			},
			{ projectRoot: project },
		);
		await writer.remember(
			{
				content: 'SQLite other project',
				scope: 'project',
				origin: 'explicit',
				source: 'user:three',
			},
			{ projectRoot: other },
		);
		await writer.remember(
			{
				content: 'Global SQLite preference',
				scope: 'global',
				origin: 'explicit',
				source: 'user:global',
			},
			{ projectRoot: project },
		);
		await writer.recall('SQLite', { projectRoot: project });
		expect(reader.activity().map((event) => event.type)).toEqual([
			'remember',
			'update',
			'link',
			'remember',
			'remember',
			'recall',
		]);
		const cursor = reader.activity().at(-1)?.id ?? 0;
		if (!original.memory) throw new Error('Expected memory');
		await writer.forget(original.memory.id, { projectRoot: project });
		expect(reader.activity(cursor).map((event) => event.type)).toEqual([
			'forget',
		]);
		const graph = await (
			await app.request(
				`/api/graph?projectId=${encodeURIComponent(project)}&includeSuperseded=true`,
			)
		).json();
		expect(
			graph.nodes.some(
				(node: { content?: string }) => node.content === 'SQLite other project',
			),
		).toBe(false);
		const global = graph.nodes.find(
			(node: { content?: string }) =>
				node.content === 'Global SQLite preference',
		);
		expect(global?.scope).toBe('global');
		expect(
			graph.edges.some(
				(edge: { to: string }) => edge.to === `topic:global::sqlite`,
			),
		).toBe(true);
		const entity = graph.nodes.find(
			(node: { kind: string; id: string }) =>
				node.kind === 'entity' && node.id === 'topic:global::sqlite',
		);
		expect(entity).toBeDefined();
		const entityDetail = await (
			await app.request(`/api/memories/${encodeURIComponent(entity.id)}`)
		).json();
		expect(entityDetail.memory.kind).toBe('entity');
		expect(entityDetail.memory.role).toBe('topic');
		expect(entityDetail.lineage).toEqual([]);
		expect(
			entityDetail.neighbors.every(
				(node: { role?: string }) => node.role !== 'source',
			),
		).toBe(true);
		expect(
			entityDetail.neighbors.some(
				(node: { id: string }) => node.id === global.id,
			),
		).toBe(true);
		expect(
			(
				await (await app.request('/api/graph?includeSuperseded=false')).json()
			).nodes.some((node: { status: string }) => node.status === 'superseded'),
		).toBe(false);
		const detail = await (
			await app.request(`/api/memories/${updated.memory?.id}`)
		).json();
		expect(detail.memory.status).toBe('current');
		expect(detail.memory.source.agent).toBe('otto');
		expect(
			detail.neighbors.every(
				(node: { role?: string }) => node.role !== 'source',
			),
		).toBe(true);
		expect(detail.lineage).toHaveLength(1);
		const before = reader.activity().length;
		expect(
			(await (await app.request('/api/search?q=SQLite')).json()).nodes.length,
		).toBeGreaterThan(0);
		expect(reader.activity()).toHaveLength(before);
		const scopes = await (await app.request('/api/scopes')).json();
		expect(scopes.projects.length).toBe(2);
		const events = await (
			await app.request(`/api/activity?sinceId=${cursor}`)
		).json();
		expect(events.events.map((event: { type: string }) => event.type)).toEqual([
			'forget',
		]);
	} finally {
		writer.close();
		reader.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test('dashboard forget uses core cleanup and records masked label and dashboard agent', async () => {
	const root = mkdtempSync(join(tmpdir(), 'otto-dashboard-delete-'));
	const path = join(root, 'memory.sqlite');
	const store = new MemoryStore(path, null, 'mcp:codex', {
		model: 'fake:test',
		dims: 2,
		async embed(values) {
			return values.map(() => new Float32Array([1, 0]));
		},
	});
	const app = createMemoryDashboardApp(path);
	try {
		const result = await store.remember(
			{
				content: 'Prefer concise responses',
				scope: 'project',
				origin: 'explicit',
				source: 'user:1',
			},
			{ projectRoot: root },
		);
		if (!result.memory) throw new Error('Expected memory');
		const id = result.memory.id;
		const before = await (await app.request(`/api/memories/${id}`)).json();
		expect(before.memory.source.agent).toBe('mcp:codex');
		expect(
			before.neighbors.every(
				(node: { role?: string }) => node.role !== 'source',
			),
		).toBe(true);
		const source = store.graph().nodes.find((node) => node.role === 'source');
		if (!source) throw new Error('Expected source entity');
		expect(
			(
				await (
					await app.request(`/api/memories/${encodeURIComponent(source.id)}`)
				).json()
			).memory.role,
		).toBe('source');
		expect(
			(
				await app.request(`/api/memories/${encodeURIComponent(source.id)}`, {
					method: 'DELETE',
				})
			).status,
		).toBe(404);
		const deleted = await app.request(`/api/memories/${id}`, {
			method: 'DELETE',
		});
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toEqual({ forgotten: true });
		expect((await app.request(`/api/memories/${id}`)).status).toBe(404);
		expect(
			(await app.request(`/api/memories/${id}`, { method: 'DELETE' })).status,
		).toBe(404);
		const event = store.activity().at(-1);
		expect(event).toMatchObject({
			type: 'forget',
			agent: 'dashboard',
			memoryIds: [id],
			details: { label: 'Prefer concise responses' },
		});
		const { Database } = await import('bun:sqlite');
		const db = new Database(path);
		try {
			expect(
				db.query('SELECT * FROM memory_embeddings WHERE memory_id = ?').all(id),
			).toHaveLength(0);
			expect(
				db
					.query('SELECT * FROM memory_edges WHERE from_id = ? OR to_id = ?')
					.all(id, id),
			).toHaveLength(0);
		} finally {
			db.close();
		}
	} finally {
		store.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test('SSE observes a write from another store instance', async () => {
	const root = mkdtempSync(join(tmpdir(), 'otto-dashboard-sse-'));
	const path = join(root, 'memory.sqlite');
	const app = createMemoryDashboardApp(path);
	const response = await app.request('/api/events');
	const reader = response.body?.getReader();
	const writer = new MemoryStore(path, null, 'mcp');
	try {
		await writer.remember(
			{
				content: 'Bun cross process',
				scope: 'global',
				origin: 'explicit',
				source: 'mcp',
			},
			{ projectRoot: root },
		);
		const text = new TextDecoder().decode((await reader?.read())?.value);
		expect(text).toContain('event: memory');
		expect(text).toContain('"agent":"mcp"');
	} finally {
		await reader?.cancel();
		writer.close();
		rmSync(root, { recursive: true, force: true });
	}
});
