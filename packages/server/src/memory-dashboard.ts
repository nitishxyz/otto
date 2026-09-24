import { Hono } from 'hono';
import { z } from 'zod/v3';
import { MemoryStore, getMemoryPath } from '@ottocode/sdk/memory';

const graphQuery = z.object({
	projectId: z.string().optional(),
	scope: z.enum(['global', 'project', 'session']).optional(),
	includeSuperseded: z
		.enum(['true', 'false'])
		.transform((value) => value === 'true')
		.optional(),
	limit: z.coerce.number().int().min(1).max(500).optional(),
});
const activityQuery = z.object({
	sinceId: z.coerce.number().int().min(0).optional(),
	limit: z.coerce.number().int().min(1).max(500).optional(),
});
const searchQuery = z.object({
	q: z.string().min(1),
	projectId: z.string().optional(),
});

/** Standalone local dashboard API; reads the same user-local store as Otto and MCP. */
export function createMemoryDashboardApp(path = getMemoryPath()): Hono {
	const app = new Hono();
	const read = <T>(fn: (store: MemoryStore) => T): T => {
		const store = new MemoryStore(path);
		try {
			return fn(store);
		} finally {
			store.close();
		}
	};
	app.get('/api/graph', (c) => {
		const parsed = graphQuery.safeParse(c.req.query());
		if (!parsed.success) return c.json({ error: 'Invalid query' }, 400);
		return c.json(read((store) => store.graph(parsed.data)));
	});
	app.get('/api/memories/:id', (c) => {
		const id = c.req.param('id');
		const graph = read((store) =>
			store.graph({ includeSuperseded: true, limit: 500 }),
		);
		const memory = graph.nodes.find((node) => node.id === id);
		if (!memory) return c.json({ error: 'Not found' }, 404);
		const edges = graph.edges.filter(
			(edge) => edge.from === id || edge.to === id,
		);
		const lineage =
			memory.kind === 'entity'
				? []
				: (read((store) =>
						store.lineage(id, {
							projectRoot: memory.projectId ?? '.',
							sessionId: memory.source?.sessionId,
						}),
					)?.timeline ?? []);
		return c.json({
			memory,
			edges,
			lineage: lineage.flatMap((item) => {
				const node = graph.nodes.find((row) => row.id === item.id);
				return node ? [node] : [];
			}),
			neighbors: graph.nodes.filter(
				(node) =>
					node.role !== 'source' &&
					edges.some((edge) => edge.from === node.id || edge.to === node.id) &&
					node.id !== id,
			),
		});
	});
	app.delete('/api/memories/:id', (c) => {
		const id = z.string().uuid().safeParse(c.req.param('id'));
		if (!id.success) return c.json({ error: 'Not found' }, 404);
		const store = new MemoryStore(path, null, 'dashboard');
		try {
			if (!store.forgetDashboard(id.data))
				return c.json({ error: 'Not found' }, 404);
			return c.json({ forgotten: true });
		} finally {
			store.close();
		}
	});
	app.get('/api/activity', (c) => {
		const parsed = activityQuery.safeParse(c.req.query());
		if (!parsed.success) return c.json({ error: 'Invalid query' }, 400);
		return c.json({
			events: read((store) =>
				store.activity(parsed.data.sinceId, parsed.data.limit),
			),
		});
	});
	app.get('/api/scopes', (c) => c.json(read((store) => store.scopes())));
	app.get('/api/search', (c) => {
		const parsed = searchQuery.safeParse(c.req.query());
		if (!parsed.success) return c.json({ error: 'Invalid query' }, 400);
		return c.json({
			nodes: read((store) =>
				store.searchDashboard(parsed.data.q, parsed.data.projectId),
			),
		});
	});
	app.get('/api/events', (c) => {
		const controller = new AbortController();
		let lastId = Math.max(
			0,
			Number(c.req.query('sinceId') ?? c.req.header('last-event-id') ?? 0) || 0,
		);
		const stream = new ReadableStream<Uint8Array>({
			start(streamController) {
				const encoder = new TextEncoder();
				const timer = setInterval(() => {
					if (controller.signal.aborted) return;
					try {
						for (const event of read((store) => store.activity(lastId, 100))) {
							streamController.enqueue(
								encoder.encode(
									`id: ${event.id}\nevent: memory\ndata: ${JSON.stringify(event)}\n\n`,
								),
							);
							lastId = Number(event.id);
						}
					} catch {
						controller.abort();
						streamController.close();
					}
				}, 300);
				controller.signal.addEventListener(
					'abort',
					() => clearInterval(timer),
					{ once: true },
				);
			},
			cancel() {
				controller.abort();
			},
		});
		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			},
		});
	});
	return app;
}

/** Serve the dashboard on loopback, including built Vite assets when present. */
export function serveMemoryDashboard(
	options: { port?: number; path?: string; assetsDir?: string } = {},
) {
	const app = createMemoryDashboardApp(options.path);
	const assetsDir = options.assetsDir;
	return Bun.serve({
		hostname: '127.0.0.1',
		port: options.port ?? 9200,
		async fetch(request) {
			const url = new URL(request.url);
			if (url.pathname.startsWith('/api/')) return app.fetch(request);
			if (assetsDir) {
				const { resolve, sep } = await import('node:path');
				const root = resolve(assetsDir);
				const target = resolve(
					root,
					`.${url.pathname === '/' ? '/index.html' : url.pathname}`,
				);
				if (target.startsWith(root + sep) || target === root) {
					const file = Bun.file(target);
					if (await file.exists()) return new Response(file);
				}
				const index = Bun.file(resolve(root, 'index.html'));
				if (await index.exists()) return new Response(index);
			}
			return new Response(
				'Memory dashboard assets unavailable. Run bun run --filter memory-dashboard build, then run otto memory dashboard from the repository or pass --assets <path>.',
				{ status: 404 },
			);
		},
	});
}
