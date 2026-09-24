/**
 * Minimal in-memory implementation of the memory dashboard API contract.
 * Useful for developing the UI without the real Hono server:
 *   bun run scripts/mock-api.ts   (listens on OTTO_MEMORY_DASHBOARD_PORT or 9200)
 *
 * MOCK_SEED=<n> controls how many seed memories exist (default: all ~14).
 * MOCK_SEED=0 exercises the empty state, MOCK_SEED=2 the sparse list view.
 * MOCK_LIVE=0 disables the random live events.
 */
import type {
	EdgeType,
	GraphEdge,
	GraphNode,
	MemoryEvent,
	MemoryEventType,
} from '../src/types.ts';

const port = Number(process.env.OTTO_MEMORY_DASHBOARD_PORT ?? 9200);
const seedLimit = Number(process.env.MOCK_SEED ?? Number.POSITIVE_INFINITY);
const live = process.env.MOCK_LIVE !== '0';
const projects = ['/Users/me/dev/agi', '/Users/me/dev/setu'];
const topicWords = ['bun', 'sqlite', 'typescript', 'react', 'testing'];
const nodes = new Map<string, GraphNode>();
const edges: GraphEdge[] = [];
const events: MemoryEvent[] = [];
const listeners = new Set<(event: MemoryEvent) => void>();
let seq = 0;
let clock = Date.now() - 3 * 24 * 3600_000;
const iso = () => new Date(clock).toISOString();
const tick = (minutes: number) => {
	clock = Math.min(Date.now(), clock + minutes * 60_000);
};

function entity(
	kind: 'topic' | 'source',
	label: string,
	scope: GraphNode['scope'],
	projectId?: string,
) {
	const id = `${kind}:${scope}:${projectId ?? ''}:${label}`;
	if (!nodes.has(id)) {
		nodes.set(id, {
			id,
			kind: 'entity',
			label,
			scope,
			...(projectId ? { projectId } : {}),
			status: 'current',
			origin: 'explicit',
			createdAt: new Date(0).toISOString(),
			updatedAt: new Date(0).toISOString(),
		});
	}
	return id;
}

function addEdge(
	from: string,
	to: string,
	type: EdgeType,
	origin: GraphEdge['origin'] = 'code',
) {
	edges.push({
		id: `${from}:${type}:${to}`,
		from,
		to,
		type,
		origin,
		createdAt: iso(),
	});
}

interface AddOptions {
	scope?: GraphNode['scope'];
	projectId?: string;
	origin?: GraphNode['origin'];
	source?: string;
	agent?: string;
	replaces?: string;
	link?: { to: string; type: EdgeType };
}

function addMemory(content: string, options: AddOptions = {}): GraphNode {
	seq += 1;
	const scope = options.scope ?? 'project';
	const projectId =
		scope === 'global' ? undefined : (options.projectId ?? projects[0]);
	const id = `mem-${seq}`;
	const node: GraphNode = {
		id,
		kind: 'memory',
		label: content.slice(0, 90),
		content,
		scope,
		...(projectId ? { projectId } : {}),
		status: 'current',
		origin: options.origin ?? 'explicit',
		createdAt: iso(),
		updatedAt: iso(),
		source: {
			agent: options.agent === 'codex' ? 'mcp' : 'otto',
			...(scope === 'session' ? { sessionId: 'sess-1' } : {}),
		},
	};
	nodes.set(id, node);
	addEdge(
		id,
		entity('source', options.source ?? 'chat with user', scope, projectId),
		'derived_from',
	);
	const topic = topicWords.find((word) => content.toLowerCase().includes(word));
	if (topic) addEdge(id, entity('topic', topic, scope, projectId), 'about');
	if (options.replaces) {
		const old = nodes.get(options.replaces);
		if (old) old.status = 'superseded';
		addEdge(id, options.replaces, 'supersedes', 'explicit');
	}
	if (options.link) addEdge(id, options.link.to, options.link.type, 'typesafe');
	return node;
}

function emit(
	type: MemoryEventType,
	ids: string[],
	extra: Partial<MemoryEvent> = {},
) {
	const event: MemoryEvent = {
		id: String(events.length + 1),
		at: iso(),
		type,
		agent: 'otto',
		memoryIds: ids,
		injectedIds: [],
		...extra,
	};
	events.push(event);
	for (const fn of listeners) fn(event);
}

function remember(content: string, options: AddOptions = {}) {
	tick(37);
	const node = addMemory(content, options);
	const type: MemoryEventType = options.replaces
		? 'update'
		: options.origin === 'inferred'
			? 'capture'
			: 'remember';
	emit(type, [node.id], {
		agent: options.agent ?? 'otto',
		scope: node.scope,
		projectId: node.projectId,
		details: { origin: node.origin },
	});
	if (options.replaces) {
		emit('link', [node.id, options.replaces], {
			details: { edgeType: 'supersedes', score: 0.92 },
		});
	}
	if (options.link) {
		emit('link', [node.id, options.link.to], {
			details: { edgeType: options.link.type, score: 0.81 },
		});
	}
	return node;
}

function recall(query: string, ids: string[], agent = 'otto') {
	tick(11);
	emit('recall', ids, {
		agent,
		query,
		ranking: ids.length ? 'typesafe' : 'fts',
		injectedIds: ids.slice(0, 1),
		projectId: projects[0],
	});
}

const seeds: Array<() => void> = [
	() =>
		remember('I prefer concise answers without long introductions.', {
			scope: 'global',
		}),
	() =>
		remember('Use npm for scripts in this repo.', {
			source: 'manual smoke test by user',
		}),
	() => recall('hey can you run the tests for me', []),
	() =>
		remember('Use Bun for scripts in this repo. npm is not used anymore.', {
			replaces: 'mem-2',
		}),
	() => recall('which package manager should I use?', ['mem-3']),
	() =>
		remember(
			'Tests live under tests/ and use bun:test; run a focused file with bun test tests/<name>.test.ts.',
			{ origin: 'inferred', link: { to: 'mem-3', type: 'refines' } },
		),
	() => recall('lets fix the lint errors', []),
	() =>
		remember(
			'Use Bun for scripts and tests in this repo; always run bun lint before finishing.',
			{ replaces: 'mem-3' },
		),
	() =>
		remember('Prefers dark themes and dense, keyboard-friendly UIs.', {
			scope: 'global',
			origin: 'inferred',
		}),
	() =>
		remember('The shared memory store is a single SQLite file per user.', {
			origin: 'inferred',
			source: 'code review',
		}),
	() =>
		remember('Setu deploys run through SST; never deploy from a dirty tree.', {
			projectId: projects[1],
		}),
	() =>
		remember('Setu uses React 19 with Vite for the dashboard.', {
			projectId: projects[1],
			origin: 'inferred',
			link: { to: 'mem-8', type: 'relates_to' },
		}),
	() =>
		remember(
			'Avoid SQLite migrations by hand; always generate them with drizzle-kit.',
			{ link: { to: 'mem-7', type: 'relates_to' } },
		),
	() =>
		remember('Hand-written SQL migrations are fine for quick fixes.', {
			scope: 'session',
			origin: 'inferred',
			link: { to: 'mem-10', type: 'contradicts' },
		}),
	() => recall('why did the migration fail?', ['mem-10', 'mem-11'], 'codex'),
	() =>
		remember('Wants TypeScript strict mode everywhere, no any.', {
			scope: 'global',
			agent: 'codex',
		}),
	() => recall('ok thanks', []),
	() => {
		const temp = remember(
			'Use port 3001 for the local API while 3000 is busy.',
		);
		tick(20);
		nodes.delete(temp.id);
		for (let i = edges.length - 1; i >= 0; i -= 1) {
			if (edges[i]?.from === temp.id || edges[i]?.to === temp.id)
				edges.splice(i, 1);
		}
		emit('forget', [temp.id], { scope: 'project', projectId: projects[0] });
	},
];
const seedCount = Math.min(
	seeds.length,
	Number.isFinite(seedLimit) ? seedLimit : seeds.length,
);
let made = 0;
for (const seed of seeds) {
	if (made >= seedCount) break;
	const before = seq;
	seed();
	if (seq > before) made += 1;
}
clock = Date.now();

const liveFacts = [
	'The CI build takes about 4 minutes; cache node_modules between runs.',
	'Prefers small, focused pull requests.',
	'Docs live under docs/; only README, AGENTS and LICENSE stay at the root.',
	'Generated catalogs must never be edited by hand.',
	'Uses tabs for indentation in TypeScript files.',
];
const liveIds: string[] = [];

if (live) {
	setInterval(() => {
		clock = Date.now();
		const ids = [...nodes.values()]
			.filter((node) => node.kind === 'memory' && node.status === 'current')
			.map((node) => node.id);
		const pick = () => ids[Math.floor(Math.random() * ids.length)];
		const roll = Math.random();
		if (roll < 0.45 || ids.length === 0) {
			recall(
				['sounds good', 'can you check the build?', 'try again'][
					Math.floor(Math.random() * 3)
				] ?? 'ok',
				[],
			);
		} else if (roll < 0.75) {
			const found = [...new Set([pick(), pick()])].filter((id): id is string =>
				Boolean(id),
			);
			recall('what conventions apply to this change?', found);
		} else if (roll < 0.9 && liveFacts.length > 0) {
			const fact = liveFacts.shift();
			if (fact) liveIds.push(remember(fact, { origin: 'inferred' }).id);
		} else if (liveIds.length > 0) {
			const target = liveIds.shift();
			const old = target ? nodes.get(target) : undefined;
			if (target && old?.status === 'current') {
				remember(`${old.content ?? ''} Confirmed again today.`, {
					replaces: target,
				});
			}
		}
	}, 8000);
}
function json(data: unknown) {
	return Response.json(data);
}

Bun.serve({
	port,
	fetch(req) {
		const url = new URL(req.url);
		const path = url.pathname;
		if (path === '/api/graph') {
			const projectId = url.searchParams.get('projectId');
			const list = [...nodes.values()].filter(
				(n) =>
					!projectId ||
					n.kind === 'entity' ||
					n.scope === 'global' ||
					n.projectId === projectId,
			);
			return json({ nodes: list, edges });
		}
		if (path.startsWith('/api/memories/')) {
			const id = decodeURIComponent(path.slice('/api/memories/'.length));
			const memory = nodes.get(id);
			if (!memory) return new Response('not found', { status: 404 });
			const own = edges.filter((e) => e.from === id || e.to === id);
			const lineage: GraphNode[] = [];
			let head = id;
			for (;;) {
				const newer = edges.find(
					(e) => e.type === 'supersedes' && e.to === head,
				);
				if (!newer) break;
				head = newer.from;
			}
			let cursor: string | undefined = head;
			while (cursor) {
				const node = nodes.get(cursor);
				if (!node) break;
				lineage.unshift(node);
				cursor = edges.find(
					(e) => e.type === 'supersedes' && e.from === cursor,
				)?.to;
			}
			const neighbors = own
				.map((e) => nodes.get(e.from === id ? e.to : e.from))
				.filter((n): n is GraphNode => Boolean(n));
			return json({ memory, edges: own, lineage, neighbors });
		}
		if (path === '/api/activity') {
			const since = Number(url.searchParams.get('sinceId') ?? 0);
			const limit = Number(url.searchParams.get('limit') ?? 100);
			return json({
				events: events.filter((e) => Number(e.id) > since).slice(0, limit),
			});
		}
		if (path === '/api/events') {
			const stream = new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder();
					const send = (event: MemoryEvent) =>
						controller.enqueue(
							encoder.encode(
								`id: ${event.id}\nevent: memory\ndata: ${JSON.stringify(event)}\n\n`,
							),
						);
					listeners.add(send);
					controller.enqueue(encoder.encode(': connected\n\n'));
					req.signal.addEventListener('abort', () => {
						listeners.delete(send);
						controller.close();
					});
				},
			});
			return new Response(stream, {
				headers: {
					'content-type': 'text/event-stream',
					'cache-control': 'no-cache',
					connection: 'keep-alive',
				},
			});
		}
		if (path === '/api/scopes') {
			const memories = [...nodes.values()].filter((n) => n.kind === 'memory');
			return json({
				projects: projects
					.map((projectId) => ({
						projectId,
						label: projectId.split('/').pop() ?? projectId,
						memoryCount: memories.filter((n) => n.projectId === projectId)
							.length,
					}))
					.filter((p) => p.memoryCount > 0),
				globalCount: memories.filter((n) => n.scope === 'global').length,
			});
		}
		if (path === '/api/search') {
			const q = (url.searchParams.get('q') ?? '').toLowerCase();
			const hits = [...nodes.values()].filter(
				(n) =>
					n.kind === 'memory' &&
					q &&
					`${n.content ?? ''}`.toLowerCase().includes(q),
			);
			return json({ nodes: hits });
		}
		return new Response('not found', { status: 404 });
	},
});

console.log(`mock memory api on http://127.0.0.1:${port}`);
