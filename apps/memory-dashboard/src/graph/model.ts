import { classifyEntities, nodeTitle } from '../lib/memories.ts';
import type {
	EdgeType,
	GraphEdge,
	GraphNode,
	GraphResponse,
	MemoryEvent,
	MemoryScope,
} from '../types.ts';

/** Edge types between two memories; the only ones the legend can toggle. */
export const MEMORY_EDGE_TYPES: readonly EdgeType[] = [
	'supersedes',
	'refines',
	'contradicts',
	'relates_to',
];

export interface GraphFilters {
	/** `null` means every project. Global memories are always included. */
	projectId: string | null;
	/** Only show memories "about you" (global scope). */
	onlyGlobal: boolean;
	/** Show replaced (superseded) and locally forgotten memories. */
	showReplaced: boolean;
	/** Draw topic tags as nodes on the map. */
	showTopics: boolean;
	edgeTypes: ReadonlySet<EdgeType>;
}

export const defaultFilters: GraphFilters = {
	projectId: null,
	onlyGlobal: false,
	showReplaced: false,
	showTopics: false,
	edgeTypes: new Set(MEMORY_EDGE_TYPES),
};

export interface LayoutNode {
	id: string;
	node: GraphNode;
	/** Short readable label used on the canvas. */
	label: string;
	degree: number;
	radius: number;
}

export interface LayoutLink {
	id: string;
	edge: GraphEdge;
	source: string;
	target: string;
	distance: number;
	strength: number;
}

export interface LayoutInputs {
	nodes: LayoutNode[];
	links: LayoutLink[];
}

const LINK_DISTANCE: Record<EdgeType, number> = {
	supersedes: 55,
	refines: 70,
	contradicts: 110,
	relates_to: 95,
	derived_from: 120,
	about: 80,
};

const LINK_STRENGTH: Record<EdgeType, number> = {
	supersedes: 1,
	refines: 0.7,
	contradicts: 0.25,
	relates_to: 0.35,
	derived_from: 0.2,
	about: 0.45,
};

function memoryNodeVisible(node: GraphNode, filters: GraphFilters): boolean {
	if (node.status !== 'current' && !filters.showReplaced) return false;
	if (node.scope === 'global') return true;
	if (filters.onlyGlobal) return false;
	if (filters.projectId && node.projectId !== filters.projectId) return false;
	return true;
}

/**
 * Applies the dashboard filters to a raw graph. Memory nodes only; topic tags
 * are added when `showTopics` is on and a visible memory points at them.
 * Provenance ("source") entities and `derived_from` edges are never drawn.
 */
export function filterGraph(
	graph: GraphResponse,
	filters: GraphFilters,
): GraphResponse {
	const { topics } = classifyEntities(graph);
	const visibleMemories = new Map<string, GraphNode>();
	const entities = new Map<string, GraphNode>();
	for (const node of graph.nodes) {
		if (node.kind === 'entity') {
			if (topics.has(node.id)) entities.set(node.id, node);
			continue;
		}
		if (memoryNodeVisible(node, filters)) visibleMemories.set(node.id, node);
	}

	const reachedTopics = new Set<string>();
	const edges: GraphEdge[] = [];
	for (const edge of graph.edges) {
		if (edge.type === 'derived_from') continue;
		if (!visibleMemories.has(edge.from)) continue;
		if (entities.has(edge.to)) {
			if (!filters.showTopics || edge.type !== 'about') continue;
			reachedTopics.add(edge.to);
			edges.push(edge);
			continue;
		}
		if (!visibleMemories.has(edge.to)) continue;
		if (!filters.edgeTypes.has(edge.type)) continue;
		edges.push(edge);
	}

	const nodes: GraphNode[] = [...visibleMemories.values()];
	for (const id of reachedTopics) {
		const entity = entities.get(id);
		if (entity) nodes.push(entity);
	}
	return { nodes, edges };
}

export interface GraphLegend {
	scopes: MemoryScope[];
	edgeTypes: EdgeType[];
	topicCount: number;
}

/** What the map legend should offer: only scopes/edge types actually present. */
export function graphLegend(
	graph: GraphResponse,
	filters: GraphFilters,
): GraphLegend {
	const all = filterGraph(graph, {
		...filters,
		showTopics: true,
		edgeTypes: new Set(MEMORY_EDGE_TYPES),
	});
	const scopes = new Set<MemoryScope>();
	let topicCount = 0;
	for (const node of all.nodes) {
		if (node.kind === 'entity') topicCount += 1;
		else scopes.add(node.scope);
	}
	const types = new Set(all.edges.map((edge) => edge.type));
	return {
		scopes: (['global', 'project', 'session'] as const).filter((scope) =>
			scopes.has(scope),
		),
		edgeTypes: MEMORY_EDGE_TYPES.filter((type) => types.has(type)),
		topicCount,
	};
}

export function computeDegrees(graph: GraphResponse): Map<string, number> {
	const degrees = new Map<string, number>();
	for (const node of graph.nodes) degrees.set(node.id, 0);
	for (const edge of graph.edges) {
		degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
		degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
	}
	return degrees;
}

export function nodeRadius(degree: number, kind: GraphNode['kind']): number {
	const base = kind === 'entity' ? 5 : 7;
	return Math.min(base + Math.sqrt(Math.max(0, degree)) * 2.6, 22);
}

/** Turns a (filtered) graph into what the force simulation consumes. */
export function buildLayoutInputs(graph: GraphResponse): LayoutInputs {
	const degrees = computeDegrees(graph);
	const ids = new Set(graph.nodes.map((node) => node.id));
	const nodes: LayoutNode[] = graph.nodes.map((node) => {
		const degree = degrees.get(node.id) ?? 0;
		return {
			id: node.id,
			node,
			label: nodeTitle(node),
			degree,
			radius: nodeRadius(degree, node.kind),
		};
	});
	const links: LayoutLink[] = graph.edges
		.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
		.map((edge) => ({
			id: edge.id,
			edge,
			source: edge.from,
			target: edge.to,
			distance: LINK_DISTANCE[edge.type],
			strength: LINK_STRENGTH[edge.type],
		}));
	return { nodes, links };
}

export type HighlightKind = 'pulse' | 'strong' | 'added' | 'removed' | 'search';

export interface HighlightDiff {
	nodes: Map<string, HighlightKind>;
	edges: Set<string>;
	/** True when the event mutated the graph and a refetch is required. */
	refetch: boolean;
	/** Ids that should be faded locally before the refetch lands. */
	forget: string[];
}

/** Maps a live MemoryEvent onto what the canvas should flash. */
export function eventToHighlight(
	event: MemoryEvent,
	graph: GraphResponse,
): HighlightDiff {
	const nodes = new Map<string, HighlightKind>();
	const edges = new Set<string>();
	const memoryIds = event.memoryIds ?? [];
	switch (event.type) {
		case 'recall': {
			for (const id of memoryIds) nodes.set(id, 'pulse');
			for (const id of event.injectedIds ?? []) nodes.set(id, 'strong');
			return { nodes, edges, refetch: false, forget: [] };
		}
		case 'remember':
		case 'capture':
		case 'update': {
			const ids = new Set(memoryIds);
			for (const id of memoryIds) nodes.set(id, 'added');
			for (const edge of graph.edges) {
				if (ids.has(edge.from) || ids.has(edge.to)) edges.add(edge.id);
			}
			return { nodes, edges, refetch: true, forget: [] };
		}
		case 'forget': {
			for (const id of memoryIds) nodes.set(id, 'removed');
			return { nodes, edges, refetch: true, forget: memoryIds };
		}
		case 'link': {
			const ids = new Set(memoryIds);
			for (const edge of graph.edges) {
				if (ids.has(edge.from) && ids.has(edge.to)) edges.add(edge.id);
			}
			for (const id of memoryIds) nodes.set(id, 'pulse');
			return { nodes, edges, refetch: true, forget: [] };
		}
		default:
			return { nodes, edges, refetch: false, forget: [] };
	}
}

/** Locally marks forgotten ids so the canvas fades them before the refetch. */
export function applyForget(
	graph: GraphResponse,
	ids: readonly string[],
): GraphResponse {
	if (ids.length === 0) return graph;
	const set = new Set(ids);
	return {
		nodes: graph.nodes.map((node) =>
			set.has(node.id) ? { ...node, status: 'forgotten' } : node,
		),
		edges: graph.edges,
	};
}

/** Merges nodes returned by search/detail into the graph without duplicates. */
export function mergeNodes(
	graph: GraphResponse,
	incoming: readonly GraphNode[],
): GraphResponse {
	if (incoming.length === 0) return graph;
	const known = new Set(graph.nodes.map((node) => node.id));
	const added = incoming.filter((node) => !known.has(node.id));
	if (added.length === 0) return graph;
	return { nodes: [...graph.nodes, ...added], edges: graph.edges };
}

export function toggleInSet<T>(set: ReadonlySet<T>, value: T): Set<T> {
	const next = new Set(set);
	if (next.has(value)) next.delete(value);
	else next.add(value);
	return next;
}
