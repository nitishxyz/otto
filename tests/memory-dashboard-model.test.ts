import { describe, expect, it } from 'bun:test';
import {
	applyForget,
	buildLayoutInputs,
	computeDegrees,
	defaultFilters,
	eventToHighlight,
	filterGraph,
	type GraphFilters,
	graphLegend,
	nodeRadius,
	toggleInSet,
} from '../apps/memory-dashboard/src/graph/model.ts';
import {
	latestEventId,
	mergeEvents,
	parseMemoryEvent,
} from '../apps/memory-dashboard/src/lib/activity.ts';
import { wordDiff } from '../apps/memory-dashboard/src/lib/diff.ts';
import {
	describeEvent,
	groupFeed,
	isQuietEvent,
} from '../apps/memory-dashboard/src/lib/feed.ts';
import {
	chooseView,
	classifyEntities,
	countMemories,
	describeCounts,
	groupMemories,
	memoryFacets,
} from '../apps/memory-dashboard/src/lib/memories.ts';
import {
	deriveTitle,
	excerpt,
	hasMoreThanTitle,
	redactSecrets,
	timeAgo,
} from '../apps/memory-dashboard/src/lib/text.ts';
import {
	agentPhrase,
	projectName,
	relationPhrase,
	scopeLabel,
} from '../apps/memory-dashboard/src/lib/vocab.ts';
import type {
	GraphEdge,
	GraphNode,
	GraphResponse,
	MemoryEvent,
} from '../apps/memory-dashboard/src/types.ts';

const at = '2026-09-23T10:00:00.000Z';
const now = Date.parse('2026-09-23T10:05:00.000Z');

function node(overrides: Partial<GraphNode> & { id: string }): GraphNode {
	return {
		kind: 'memory',
		label: overrides.id,
		scope: 'project',
		projectId: '/dev/p1',
		status: 'current',
		origin: 'explicit',
		createdAt: at,
		updatedAt: at,
		...overrides,
	};
}

function edge(
	id: string,
	from: string,
	to: string,
	type: GraphEdge['type'],
): GraphEdge {
	return { id, from, to, type, origin: 'code', createdAt: at };
}

function fixture(): GraphResponse {
	return {
		nodes: [
			node({ id: 'a', content: 'Use Bun for everything' }),
			node({ id: 'a0', status: 'superseded', content: 'Use npm' }),
			node({ id: 'g', scope: 'global', projectId: undefined }),
			node({ id: 's', scope: 'session' }),
			node({ id: 'other', projectId: '/dev/p2' }),
			node({ id: 'gone', status: 'forgotten' }),
			node({ id: 'topic:bun', kind: 'entity', label: 'bun', scope: 'global' }),
			node({ id: 'lonely', kind: 'entity', label: 'Orphan', scope: 'global' }),
			node({
				id: 'source:project:p1:manual',
				kind: 'entity',
				label: 'manual smoke test by user',
			}),
		],
		edges: [
			edge('e1', 'a', 'a0', 'supersedes'),
			edge('e2', 'a', 'topic:bun', 'about'),
			edge('e3', 'other', 'topic:bun', 'about'),
			edge('e4', 'a', 'g', 'relates_to'),
			edge('e5', 'a', 'source:project:p1:manual', 'derived_from'),
			edge('e6', 'g', 's', 'contradicts'),
			edge('e7', 'other', 'lonely', 'about'),
		],
	};
}

describe('memory dashboard graph model', () => {
	it('shows only current memories and memory-to-memory links by default', () => {
		const visible = filterGraph(fixture(), defaultFilters);
		expect(visible.nodes.map((n) => n.id).sort()).toEqual([
			'a',
			'g',
			'other',
			's',
		]);
		expect(visible.edges.map((e) => e.id).sort()).toEqual(['e4', 'e6']);
	});

	it('never renders provenance sources as nodes, even with topics on', () => {
		const visible = filterGraph(fixture(), {
			...defaultFilters,
			showTopics: true,
		});
		const ids = visible.nodes.map((n) => n.id);
		expect(ids).toContain('topic:bun');
		expect(ids).toContain('lonely');
		expect(ids).not.toContain('source:project:p1:manual');
		expect(visible.edges.some((e) => e.type === 'derived_from')).toBe(false);
	});

	it('includes replaced versions when requested', () => {
		const visible = filterGraph(fixture(), {
			...defaultFilters,
			showReplaced: true,
		});
		expect(visible.nodes.some((n) => n.id === 'a0')).toBe(true);
		expect(visible.nodes.some((n) => n.id === 'gone')).toBe(true);
		expect(visible.edges.some((e) => e.id === 'e1')).toBe(true);
	});

	it('scopes to a project (keeping "about you") or to global only', () => {
		const project: GraphFilters = { ...defaultFilters, projectId: '/dev/p1' };
		expect(
			filterGraph(fixture(), project)
				.nodes.map((n) => n.id)
				.sort(),
		).toEqual(['a', 'g', 's']);
		const onlyGlobal = filterGraph(fixture(), {
			...defaultFilters,
			onlyGlobal: true,
		});
		expect(onlyGlobal.nodes.map((n) => n.id)).toEqual(['g']);
	});

	it('drops links whose type is toggled off in the legend', () => {
		const visible = filterGraph(fixture(), {
			...defaultFilters,
			edgeTypes: toggleInSet(defaultFilters.edgeTypes, 'contradicts'),
		});
		expect(visible.edges.map((e) => e.id)).toEqual(['e4']);
	});

	it('legend lists only scopes and link types that are present', () => {
		const legend = graphLegend(fixture(), {
			...defaultFilters,
			edgeTypes: new Set(),
		});
		expect(legend.scopes).toEqual(['global', 'project', 'session']);
		expect(legend.edgeTypes).toEqual(['contradicts', 'relates_to']);
		expect(legend.topicCount).toBe(2);
	});

	it('builds layout inputs with readable labels and degree-driven radius', () => {
		const visible = filterGraph(fixture(), {
			...defaultFilters,
			showReplaced: true,
		});
		const inputs = buildLayoutInputs(visible);
		const degrees = computeDegrees(visible);
		expect(degrees.get('a')).toBe(2);
		const a = inputs.nodes.find((n) => n.id === 'a');
		expect(a?.label).toBe('Use Bun for everything');
		expect(a?.radius).toBe(nodeRadius(2, 'memory'));
		const supersedes = inputs.links.find((l) => l.edge.type === 'supersedes');
		expect(supersedes?.strength).toBeGreaterThan(
			inputs.links.find((l) => l.edge.type === 'contradicts')?.strength ?? 1,
		);
	});

	it('maps recall events to pulse/strong highlights without a refetch', () => {
		const event: MemoryEvent = {
			id: '1',
			at,
			type: 'recall',
			agent: 'otto',
			memoryIds: ['a', 'g'],
			injectedIds: ['a'],
			query: 'bun',
		};
		const diff = eventToHighlight(event, fixture());
		expect(diff.nodes.get('a')).toBe('strong');
		expect(diff.nodes.get('g')).toBe('pulse');
		expect(diff.refetch).toBe(false);
	});

	it('flashes on remember, fades on forget, flashes edges on link', () => {
		const remember = eventToHighlight(
			{ id: '2', at, type: 'remember', agent: 'otto', memoryIds: ['a'] },
			fixture(),
		);
		expect(remember.nodes.get('a')).toBe('added');
		expect(remember.refetch).toBe(true);
		const forget = eventToHighlight(
			{ id: '3', at, type: 'forget', agent: 'otto', memoryIds: ['g'] },
			fixture(),
		);
		expect(forget.forget).toEqual(['g']);
		const faded = applyForget(fixture(), forget.forget);
		expect(faded.nodes.find((n) => n.id === 'g')?.status).toBe('forgotten');
		const link = eventToHighlight(
			{ id: '4', at, type: 'link', agent: 'otto', memoryIds: ['g', 's'] },
			fixture(),
		);
		expect([...link.edges]).toEqual(['e6']);
	});
});

describe('memory dashboard list model', () => {
	it('classifies sources vs topics and collects per-memory facets', () => {
		const { sources, topics } = classifyEntities(fixture());
		expect([...sources]).toEqual(['source:project:p1:manual']);
		expect([...topics].sort()).toEqual(['lonely', 'topic:bun']);
		const facets = memoryFacets(fixture());
		expect(facets.get('a')).toEqual({
			topics: ['bun'],
			source: 'manual smoke test by user',
			links: 1,
		});
	});

	it('groups memories as "About you" first, then projects by size', () => {
		const sections = groupMemories(
			filterGraph(fixture(), defaultFilters).nodes,
		);
		expect(sections.map((s) => s.title)).toEqual(['About you', 'p1', 'p2']);
		expect(sections[1]?.hint).toBe('/dev/p1');
		expect(sections[1]?.memories.map((m) => m.id)).toEqual(['a', 's']);
	});

	it('describes counts in words', () => {
		expect(describeCounts(countMemories(fixture()))).toBe(
			'4 memories \u00b7 1 about you \u00b7 2 in p1 \u00b7 1 in p2',
		);
		expect(describeCounts(countMemories({ nodes: [], edges: [] }))).toBe(
			'Nothing remembered yet',
		);
	});

	it('defaults to the list until the map has enough to show', () => {
		const few: GraphResponse = {
			nodes: [node({ id: 'x' }), node({ id: 'y' })],
			edges: [edge('xy', 'x', 'y', 'relates_to')],
		};
		expect(chooseView(few)).toBe('list');
		const linked: GraphResponse = {
			nodes: [...few.nodes, node({ id: 'z' })],
			edges: few.edges,
		};
		expect(chooseView(linked)).toBe('graph');
		const many: GraphResponse = {
			nodes: Array.from({ length: 9 }, (_, i) => node({ id: `m${i}` })),
			edges: [],
		};
		expect(chooseView(many)).toBe('graph');
		expect(chooseView({ nodes: many.nodes.slice(0, 8), edges: [] })).toBe(
			'list',
		);
	});
});

describe('memory dashboard vocabulary', () => {
	it('uses plain words for scope, relations and agents', () => {
		expect(projectName('/Users/me/dev/agi/')).toBe('agi');
		expect(scopeLabel({ scope: 'global' }).text).toBe('About you');
		const project = scopeLabel({ scope: 'project', projectId: '/x/agi' });
		expect(project.text).toBe('agi');
		expect(project.title).toContain('/x/agi');
		expect(scopeLabel({ scope: 'session', projectId: '/x/agi' }).text).toBe(
			'One chat in agi',
		);
		expect(relationPhrase('supersedes', true)).toBe('Replaces');
		expect(relationPhrase('supersedes', false)).toBe('Replaced by');
		expect(relationPhrase('refines', true)).toBe('Adds detail to');
		expect(relationPhrase('contradicts', false)).toBe('Conflicts with');
		expect(agentPhrase('otto')).toBeNull();
		expect(agentPhrase('mcp')).toBeNull();
		expect(agentPhrase('codex')).toBe('via Codex');
	});

	it('derives short titles from memory text', () => {
		expect(deriveTitle('Use Bun 1.4 everywhere. npm is banned.')).toBe(
			'Use Bun 1.4 everywhere',
		);
		expect(deriveTitle('- prefers tabs')).toBe('prefers tabs');
		expect(deriveTitle('')).toBe('Untitled memory');
		expect(deriveTitle('x'.repeat(200)).length).toBe(80);
		expect(hasMoreThanTitle('Use Bun.', 'Use Bun')).toBe(false);
		expect(hasMoreThanTitle('Use Bun. Always.', 'Use Bun')).toBe(true);
		expect(timeAgo('2026-09-23T09:51:00.000Z', now)).toBe('14 minutes ago');
		expect(timeAgo(at, Date.parse(at) + 1000)).toBe('just now');
	});

	it('diffs versions word by word', () => {
		expect(wordDiff('Use npm for scripts', 'Use Bun for scripts')).toEqual([
			{ kind: 'same', text: 'Use ' },
			{ kind: 'removed', text: 'npm' },
			{ kind: 'added', text: 'Bun' },
			{ kind: 'same', text: ' for scripts' },
		]);
		expect(
			wordDiff('Use npm', 'Prefers tabs over spaces everywhere'),
		).toBeNull();
	});
});

describe('memory dashboard activity feed', () => {
	const noon = new Date(2026, 8, 23, 12, 0).getTime();
	const ev = (
		id: string,
		minutesAgo: number,
		extra: Partial<MemoryEvent> = {},
	): MemoryEvent => ({
		id,
		at: new Date(noon - minutesAgo * 60_000).toISOString(),
		type: 'recall',
		agent: 'otto',
		memoryIds: [],
		...extra,
	});
	const labels = new Map([
		['a', 'Use Bun'],
		['b', 'Prefers tabs'],
	]);
	const labelOf = (id: string) => labels.get(id);

	it('phrases events as sentences and hides internal labels', () => {
		const used = describeEvent(
			ev('1', 0, {
				memoryIds: ['a'],
				query: 'which package manager?',
				ranking: 'fts',
			}),
			labelOf,
		);
		expect(`${used.verb} ${used.subject}`).toBe(
			'Used 1 memory for which package manager?',
		);
		expect(used.via).toBeNull();
		const update = describeEvent(
			ev('2', 0, { type: 'update', memoryIds: ['a'], agent: 'codex' }),
			labelOf,
		);
		expect(update.verb).toBe('Updated');
		expect(update.subject).toBe('Use Bun');
		expect(update.note).toBe('replaced an older version');
		expect(update.via).toBe('via Codex');
		const forgot = describeEvent(
			ev('3', 0, { type: 'forget', memoryIds: ['zzz'] }),
			labelOf,
		);
		expect(`${forgot.verb}: ${forgot.subject}`).toBe('Forgot: a memory');
		const link = describeEvent(
			ev('4', 0, {
				type: 'link',
				memoryIds: ['a', 'b'],
				details: { edgeType: 'contradicts' },
			}),
			labelOf,
		);
		expect(link.subject).toBe('Use Bun \u2194 Prefers tabs');
		expect(link.note).toBe('conflicts');
	});

	it('treats empty lookups and replacement links as quiet', () => {
		expect(isQuietEvent(ev('1', 0))).toBe(true);
		expect(isQuietEvent(ev('2', 0, { memoryIds: ['a'] }))).toBe(false);
		expect(
			isQuietEvent(
				ev('3', 0, {
					type: 'link',
					memoryIds: ['a', 'b'],
					details: { edgeType: 'supersedes' },
				}),
			),
		).toBe(true);
	});

	it('groups by time and hides quiet events unless asked', () => {
		const events = [
			ev('4', 1, { type: 'remember', memoryIds: ['a'] }),
			ev('3', 2),
			ev('2', 30, { memoryIds: ['a'], query: 'q' }),
			ev('1', 60 * 24 * 3, { type: 'remember', memoryIds: ['b'] }),
		];
		const quiet = groupFeed(events, { now: noon, showAll: false, labelOf });
		expect(quiet.hiddenCount).toBe(1);
		expect(quiet.groups.map((g) => [g.title, g.items.length])).toEqual([
			['Just now', 1],
			['Today', 1],
			['Earlier', 1],
		]);
		const all = groupFeed(events, { now: noon, showAll: true, labelOf });
		expect(all.hiddenCount).toBe(0);
		expect(all.groups[0]?.items.length).toBe(2);
	});
});

describe('memory dashboard activity buffer', () => {
	const ev = (id: string, minute: number): MemoryEvent => ({
		id,
		at: `2026-09-23T10:${String(minute).padStart(2, '0')}:00.000Z`,
		type: 'recall',
		agent: 'otto',
		memoryIds: [],
	});

	it('merges newest-first, dedupes and caps', () => {
		const first = mergeEvents([], [ev('1', 1), ev('2', 2)]);
		expect(first.events.map((e) => e.id)).toEqual(['2', '1']);
		const second = mergeEvents(first.events, [ev('2', 2), ev('3', 3)], 2);
		expect(second.added.map((e) => e.id)).toEqual(['3']);
		expect(second.events.map((e) => e.id)).toEqual(['3', '2']);
		expect(latestEventId(second.events)).toBe('3');
	});

	it('parses SSE payloads defensively', () => {
		expect(parseMemoryEvent('not json')).toBeNull();
		expect(parseMemoryEvent('{"type":"recall"}')).toBeNull();
		const parsed = parseMemoryEvent(
			JSON.stringify({ id: 7, type: 'capture', memoryIds: [1, 2] }),
		);
		expect(parsed?.id).toBe('7');
		expect(parsed?.memoryIds).toEqual(['1', '2']);
		expect(parsed?.agent).toBe('unknown');
	});
});

describe('memory dashboard text helpers', () => {
	it('redacts credential-shaped text and truncates excerpts', () => {
		expect(redactSecrets('key sk-abcdefghijklmnopqrstuvwxyz ok')).toBe(
			'key [redacted] ok',
		);
		expect(redactSecrets('AKIAABCDEFGHIJKLMNOP here')).toBe('[redacted] here');
		expect(redactSecrets('api_key: supersecretvalue123')).toBe('[redacted]');
		expect(redactSecrets('plain preference text')).toBe(
			'plain preference text',
		);
		expect(excerpt('a  b\n c', 10)).toBe('a b c');
		expect(excerpt('x'.repeat(20), 10)).toHaveLength(10);
	});
});
