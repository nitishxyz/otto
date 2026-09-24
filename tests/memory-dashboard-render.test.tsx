import { describe, expect, it } from 'bun:test';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityFeed } from '../apps/memory-dashboard/src/components/ActivityFeed.tsx';
import { DetailPanel } from '../apps/memory-dashboard/src/components/DetailPanel.tsx';
import { EmptyState } from '../apps/memory-dashboard/src/components/EmptyState.tsx';
import { Header } from '../apps/memory-dashboard/src/components/Header.tsx';
import { MemoryList } from '../apps/memory-dashboard/src/components/MemoryList.tsx';
import { Toolbar } from '../apps/memory-dashboard/src/components/Toolbar.tsx';
import {
	countMemories,
	groupMemories,
	memoryFacets,
} from '../apps/memory-dashboard/src/lib/memories.ts';
import type {
	GraphEdge,
	GraphNode,
	MemoryDetailResponse,
	MemoryEvent,
} from '../apps/memory-dashboard/src/types.ts';

const at = '2026-09-23T10:00:00.000Z';
const now = Date.parse('2026-09-23T10:14:00.000Z');

const memory: GraphNode = {
	id: '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b',
	kind: 'memory',
	label: 'Always use Bun',
	content:
		'Always use Bun for scripts. <script>alert(1)</script> token=sk-abcdefghijklmnopqrstuvwxyz',
	scope: 'project',
	projectId: '/Users/me/dev/agi',
	status: 'current',
	origin: 'explicit',
	createdAt: at,
	updatedAt: at,
	source: { agent: 'otto' },
};

const older: GraphNode = {
	...memory,
	id: 'mem-0',
	label: 'Use npm for scripts',
	content: 'Use npm for scripts',
	status: 'superseded',
	createdAt: '2026-09-22T10:00:00.000Z',
	updatedAt: '2026-09-22T10:00:00.000Z',
};

const conflicting: GraphNode = {
	...memory,
	id: 'mem-c',
	label: 'Use yarn',
	content: 'Use yarn for everything',
	scope: 'global',
	projectId: undefined,
};

const topic: GraphNode = {
	id: 'topic:project:agi:bun',
	kind: 'entity',
	label: 'bun',
	scope: 'project',
	status: 'current',
	origin: 'explicit',
	createdAt: at,
	updatedAt: at,
};

const source: GraphNode = {
	...topic,
	id: 'source:project:agi:manual smoke test by user',
	label: 'manual smoke test by user',
};

function edge(from: string, to: string, type: GraphEdge['type']): GraphEdge {
	return {
		id: `${from}:${type}:${to}`,
		from,
		to,
		type,
		origin: 'code',
		createdAt: at,
	};
}

const detail: MemoryDetailResponse = {
	memory,
	edges: [
		edge(memory.id, older.id, 'supersedes'),
		edge(memory.id, topic.id, 'about'),
		edge(memory.id, source.id, 'derived_from'),
		edge(conflicting.id, memory.id, 'contradicts'),
	],
	lineage: [older, memory],
	neighbors: [older, topic, source, conflicting],
};

/** Visible text only (drops tags, class names and attribute values). */
function visibleText(markup: string): string {
	return markup.replace(/<[^>]+>/g, ' ');
}

function renderDetail(
	props: Partial<Parameters<typeof DetailPanel>[0]> = {},
): string {
	return renderToStaticMarkup(
		<DetailPanel
			nodeId={memory.id}
			fallback={memory}
			detail={detail}
			loading={false}
			error={null}
			now={now}
			onClose={() => {}}
			onSelect={() => {}}
			{...props}
		/>,
	);
}

describe('memory dashboard render smoke', () => {
	it('renders the header summary in words with a live dot', () => {
		const counts = countMemories({
			nodes: [memory, older, conflicting, topic],
			edges: [],
		});
		const markup = renderToStaticMarkup(
			<Header counts={counts} status="polling" lastEventAt={at} now={now} />,
		);
		expect(markup).toContain('What Otto remembers');
		expect(markup).toContain('2 memories');
		expect(markup).toContain('1 about you');
		expect(markup).toContain('1 in agi');
		expect(markup).toContain('Reconnecting');
		expect(visibleText(markup)).not.toContain('polling');
		expect(markup).toContain('Last activity 14 minutes ago');
	});

	it('renders detail once, in plain language, with source as text', () => {
		const markup = renderDetail();
		expect(markup).toContain(
			'<h2 class="detail-title">Always use Bun for scripts</h2>',
		);
		const [head] = markup.split('How this changed');
		// title + body once; the timeline below may repeat versions
		expect(head.split('Always use Bun for scripts').length - 1).toBe(2);
		expect(markup).toContain(
			'title="Only used when working in this project (/Users/me/dev/agi)"',
		);
		expect(markup).toContain('>agi<');
		expect(markup).toContain('You told Otto');
		expect(markup).toContain('manual smoke test by user');
		expect(markup).toContain('Remembered 14 minutes ago');
		expect(markup).not.toContain('updated');
		expect(markup).not.toContain(memory.id);
		expect(markup).not.toContain('otto');
		expect(markup).toContain('class="tag">bun<');
		expect(markup).toContain('How this changed');
		expect(markup).toContain('2 versions');
		expect(markup).toContain('First noted');
		expect(markup).toContain('Latest');
		expect(markup).toContain('Related memories');
		expect(markup).toContain('Conflicts with');
		expect(markup).not.toContain('neighbors');
		expect(markup).toContain('[redacted]');
		expect(markup).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
		expect(markup).not.toContain('<script>');
		expect(markup).toContain('&lt;script&gt;');
		expect(markup).toContain('Copy text');
	});

	it('omits the timeline without a replacement chain and shows the updated time', () => {
		const markup = renderDetail({
			detail: {
				...detail,
				memory: { ...memory, updatedAt: '2026-09-23T10:10:00.000Z' },
				lineage: [memory],
			},
		});
		expect(markup).not.toContain('How this changed');
		expect(markup).toContain('updated 4 minutes ago');
		expect(markup).toContain('Replaces');
	});

	it('renders a topic selection as a list of tagged memories', () => {
		const markup = renderDetail({
			nodeId: topic.id,
			fallback: topic,
			detail: null,
			topicMembers: [memory],
		});
		expect(markup).toContain('Topic');
		expect(markup).toContain('1 memory is tagged');
		expect(markup).toContain('Always use Bun for scripts');
	});

	it('renders the list view grouped by scope with cards', () => {
		const graph = {
			nodes: [memory, conflicting, topic, source],
			edges: detail.edges,
		};
		const markup = renderToStaticMarkup(
			<MemoryList
				sections={groupMemories(graph.nodes)}
				facets={memoryFacets(graph)}
				selectedId={memory.id}
				flashIds={new Set([conflicting.id])}
				focus={null}
				now={now}
				onSelect={() => {}}
			/>,
		);
		expect(markup.indexOf('About you')).toBeLessThan(markup.indexOf('agi'));
		expect(markup).toContain('title="/Users/me/dev/agi"');
		expect(markup).toContain('Always use Bun for scripts');
		expect(markup).toContain('card card-current selected');
		expect(markup).toContain('flash');
		expect(markup).toContain('You told Otto');
		expect(markup).toContain('1 link');
		expect(markup).toContain('>bun<');
		expect(markup).not.toContain('manual smoke test');
		expect(markup).not.toContain('<script>');
	});

	it('renders recent activity as grouped sentences and hides empty lookups', () => {
		const events: MemoryEvent[] = [
			{
				id: '3',
				at: new Date(now - 30_000).toISOString(),
				type: 'recall',
				agent: 'otto',
				memoryIds: [],
				query: 'hey can you run the tests',
				ranking: 'fts',
			},
			{
				id: '2',
				at: new Date(now - 60_000).toISOString(),
				type: 'recall',
				agent: 'otto',
				memoryIds: [memory.id],
				injectedIds: [memory.id],
				query: 'which package manager?',
				ranking: 'typesafe',
			},
			{
				id: '1',
				at: new Date(now - 120_000).toISOString(),
				type: 'update',
				agent: 'codex',
				memoryIds: [memory.id],
			},
		];
		const labels = new Map([[memory.id, 'Always use Bun for scripts']]);
		const markup = renderToStaticMarkup(
			<ActivityFeed
				events={events}
				labels={labels}
				now={now}
				activeId="2"
				onFocus={() => {}}
			/>,
		);
		expect(markup).toContain('Recent activity');
		expect(markup).toContain('Just now');
		expect(markup).toContain('Used 1 memory for');
		expect(markup).toContain('which package manager?');
		expect(markup).toContain('Updated');
		expect(markup).toContain('replaced an older version');
		expect(markup).toContain('via Codex');
		expect(markup).toContain('Show all (1 hidden)');
		expect(markup).not.toContain('hey can you run the tests');
		expect(markup).not.toContain('fts');
		expect(markup).not.toContain('typesafe');
		expect(markup).toContain('event event-used active');

		const all = renderToStaticMarkup(
			<ActivityFeed
				events={events}
				labels={labels}
				now={now}
				activeId={null}
				onFocus={() => {}}
				initialShowAll
			/>,
		);
		expect(all).toContain('Looked up');
		expect(all).toContain('nothing relevant');
		expect(all).toContain('Show less');
	});

	it('renders a compact toolbar without jargon', () => {
		const markup = renderToStaticMarkup(
			<Toolbar
				scopeValue=""
				projects={[{ projectId: '/repo/agi', name: 'agi', count: 3 }]}
				globalCount={2}
				view="list"
				showViewSwitch
				search=""
				searchCount={null}
				searchRef={createRef<HTMLInputElement>()}
				showReplaced={false}
				replacedCount={1}
				onScope={() => {}}
				onView={() => {}}
				onSearch={() => {}}
				onToggleReplaced={() => {}}
			/>,
		);
		expect(markup).toContain('Everything');
		expect(markup).toContain('About you (2)');
		expect(markup).toContain('agi (3)');
		expect(markup).toContain('List');
		expect(markup).toContain('Map');
		expect(markup).toContain('More');
		for (const jargon of ['supersedes', 'derived', 'global', 'session']) {
			expect(visibleText(markup)).not.toContain(jargon);
		}
	});

	it('renders a friendly empty state', () => {
		const markup = renderToStaticMarkup(<EmptyState kind="empty" />);
		expect(markup).toContain('Otto hasn&#x27;t remembered anything yet');
		expect(markup).toContain('useful facts');
	});
});
