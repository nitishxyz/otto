import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { ActivityFeed } from './components/ActivityFeed.tsx';
import { DetailPanel } from './components/DetailPanel.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { Header } from './components/Header.tsx';
import { MemoryList } from './components/MemoryList.tsx';
import { ONLY_GLOBAL, Toolbar } from './components/Toolbar.tsx';
import { GraphView } from './graph/GraphView.tsx';
import {
	applyForget,
	buildLayoutInputs,
	defaultFilters,
	eventToHighlight,
	filterGraph,
	type GraphFilters,
	graphLegend,
	toggleInSet,
} from './graph/model.ts';
import { useActivityStream } from './hooks/useActivityStream.ts';
import { useHighlights } from './hooks/useHighlights.ts';
import { useMemoryDetail } from './hooks/useMemoryDetail.ts';
import { useMemoryGraph } from './hooks/useMemoryGraph.ts';
import { useSearch } from './hooks/useSearch.ts';
import {
	chooseView,
	countMemories,
	groupMemories,
	type MainView,
	memoryFacets,
	nodeTitle,
	projectOptions,
} from './lib/memories.ts';
import type { EdgeType, GraphNode, MemoryEvent } from './types.ts';

const FORGET_FADE_MS = 1500;
const REFETCH_DEBOUNCE_MS = 400;
const NO_IDS: ReadonlySet<string> = new Set();

export function App() {
	const [filters, setFilters] = useState<GraphFilters>(defaultFilters);
	const [viewChoice, setViewChoice] = useState<MainView | null>(null);
	const [search, setSearch] = useState('');
	const [activeEventId, setActiveEventId] = useState<string | null>(null);
	const [focus, setFocus] = useState<{ ids: string[]; key: number } | null>(
		null,
	);
	const [now, setNow] = useState(() => Date.now());
	const searchRef = useRef<HTMLInputElement | null>(null);
	const highlights = useHighlights();
	const data = useMemoryGraph(filters.projectId);
	const { graph, setGraph, scheduleRefetch } = data;
	const graphRef = useRef(graph);
	graphRef.current = graph;
	const searchResult = useSearch(search, filters.projectId);

	const lookup = useCallback(
		(id: string) => graphRef.current.nodes.find((node) => node.id === id),
		[],
	);
	const { detail, select } = useMemoryDetail(lookup);

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 15_000);
		return () => clearInterval(timer);
	}, []);

	const onEvent = useCallback(
		(event: MemoryEvent) => {
			const diff = eventToHighlight(event, graphRef.current);
			highlights.flash(diff);
			setNow(Date.now());
			if (diff.forget.length > 0) {
				setGraph((prev) => applyForget(prev, diff.forget));
				scheduleRefetch(FORGET_FADE_MS);
			} else if (diff.refetch) {
				scheduleRefetch(REFETCH_DEBOUNCE_MS);
			}
		},
		[highlights.flash, scheduleRefetch, setGraph],
	);
	const stream = useActivityStream(onEvent);

	const selectNode = useCallback(
		(id: string | null, recenter = false) => {
			if (id && recenter) setFocus({ ids: [id], key: Date.now() });
			select(id);
		},
		[select],
	);

	const focusEvent = useCallback(
		(event: MemoryEvent) => {
			setActiveEventId(event.id);
			const ids = event.memoryIds;
			if (ids.length === 0) return;
			setFocus({ ids, key: Date.now() });
			const nodes = new Map<string, 'pulse' | 'strong'>();
			for (const id of ids) nodes.set(id, 'pulse');
			for (const id of event.injectedIds ?? []) nodes.set(id, 'strong');
			highlights.flash({ nodes, edges: new Set() });
			if (ids.length === 1) select(ids[0]);
		},
		[highlights.flash, select],
	);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const typing =
				target &&
				(target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.tagName === 'SELECT');
			if (event.key === 'Escape') {
				if (typing && target === searchRef.current && search) {
					setSearch('');
					return;
				}
				if (typing) target.blur();
				select(null);
				return;
			}
			if (event.key === '/' && !typing) {
				event.preventDefault();
				searchRef.current?.focus();
				searchRef.current?.select();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [search, select]);

	const visible = useMemo(() => filterGraph(graph, filters), [graph, filters]);
	const inputs = useMemo(() => buildLayoutInputs(visible), [visible]);
	const legend = useMemo(() => graphLegend(graph, filters), [graph, filters]);
	const facets = useMemo(() => memoryFacets(graph), [graph]);
	const counts = useMemo(() => countMemories(graph), [graph]);
	const nodeById = useMemo(
		() => new Map(graph.nodes.map((node) => [node.id, node])),
		[graph],
	);

	const labelCache = useRef(new Map<string, string>());
	const labels = useMemo(() => {
		for (const node of graph.nodes) {
			if (node.kind === 'memory') {
				labelCache.current.set(node.id, nodeTitle(node));
			}
		}
		return new Map(labelCache.current);
	}, [graph]);

	const sections = useMemo(() => {
		const ids = searchResult.ids;
		const nodes = visible.nodes.filter(
			(node) => node.kind === 'memory' && (!ids || ids.has(node.id)),
		);
		return groupMemories(nodes);
	}, [visible, searchResult.ids]);

	const topicMembers = useMemo(() => {
		if (!detail || nodeById.get(detail.id)?.kind !== 'entity') return [];
		const members: GraphNode[] = [];
		for (const edge of graph.edges) {
			if (edge.to !== detail.id) continue;
			const node = nodeById.get(edge.from);
			if (node?.kind === 'memory') members.push(node);
		}
		return members;
	}, [detail, graph, nodeById]);

	const flashIds = useMemo(
		() => new Set(highlights.nodes.keys()),
		[highlights.nodes],
	);

	const totalMemories = graph.nodes.filter((n) => n.kind === 'memory').length;
	const replacedCount = graph.nodes.filter(
		(n) => n.kind === 'memory' && n.status !== 'current',
	).length;
	const visibleMemories = visible.nodes.filter(
		(n) => n.kind === 'memory',
	).length;
	const hasMemories = totalMemories > 0;
	const view: MainView = hasMemories
		? (viewChoice ?? chooseView(visible))
		: 'list';

	const update = (patch: Partial<GraphFilters>) =>
		setFilters((prev) => ({ ...prev, ...patch }));
	const scopeValue = filters.onlyGlobal
		? ONLY_GLOBAL
		: (filters.projectId ?? '');
	const resetView = () => {
		setSearch('');
		setFilters(defaultFilters);
	};

	let main: ReactNode;
	if (!data.loaded) {
		main = <EmptyState kind="loading" />;
	} else if (data.error && !hasMemories) {
		main = (
			<EmptyState kind="error" detail={data.error} onAction={data.reload} />
		);
	} else if (!hasMemories && !filters.projectId && !filters.onlyGlobal) {
		main = <EmptyState kind="empty" />;
	} else if (view === 'list' && sections.length === 0) {
		main = <EmptyState kind="nomatch" onAction={resetView} />;
	} else if (view === 'graph' && visibleMemories === 0) {
		main = <EmptyState kind="nomatch" onAction={resetView} />;
	} else if (view === 'list') {
		main = (
			<MemoryList
				sections={sections}
				facets={facets}
				selectedId={detail?.id ?? null}
				flashIds={flashIds}
				focus={focus}
				now={now}
				onSelect={(id) => selectNode(id)}
			/>
		);
	} else {
		main = (
			<GraphView
				inputs={inputs}
				legend={legend}
				edgeTypes={filters.edgeTypes}
				showTopics={filters.showTopics}
				resetKey={scopeValue}
				selectedId={detail?.id ?? null}
				onSelect={(id) => selectNode(id)}
				searchIds={searchResult.ids ?? NO_IDS}
				nodeHighlights={highlights.nodes}
				edgeHighlights={highlights.edges}
				focus={focus}
				onToggleEdge={(type: EdgeType) =>
					update({ edgeTypes: toggleInSet(filters.edgeTypes, type) })
				}
				onToggleTopics={() => update({ showTopics: !filters.showTopics })}
			/>
		);
	}

	return (
		<div className="app">
			<Header
				counts={counts}
				status={stream.status}
				lastEventAt={stream.lastEventAt}
				now={now}
			/>
			<Toolbar
				scopeValue={scopeValue}
				projects={projectOptions(data.scopes)}
				globalCount={data.scopes?.globalCount ?? null}
				view={view}
				showViewSwitch={hasMemories}
				search={search}
				searchCount={searchResult.ids ? searchResult.ids.size : null}
				searchRef={searchRef}
				showReplaced={filters.showReplaced}
				replacedCount={replacedCount}
				onScope={(value) =>
					update({
						onlyGlobal: value === ONLY_GLOBAL,
						projectId: value && value !== ONLY_GLOBAL ? value : null,
					})
				}
				onView={setViewChoice}
				onSearch={setSearch}
				onToggleReplaced={() => update({ showReplaced: !filters.showReplaced })}
			/>
			<main className="body">
				<div className={`main-area${detail ? ' has-detail' : ''}`}>
					{main}
					{detail ? (
						<DetailPanel
							nodeId={detail.id}
							fallback={nodeById.get(detail.id) ?? null}
							detail={detail.data}
							loading={detail.loading}
							error={detail.error}
							now={now}
							topicMembers={topicMembers}
							onClose={() => select(null)}
							onSelect={(id) => selectNode(id, true)}
						/>
					) : null}
				</div>
				<ActivityFeed
					events={stream.events}
					labels={labels}
					now={now}
					activeId={activeEventId}
					onFocus={focusEvent}
				/>
			</main>
		</div>
	);
}
