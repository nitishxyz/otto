import type { GraphNode, GraphResponse, ScopesResponse } from '../types.ts';
import { deriveTitle, redactSecrets } from './text.ts';
import { pluralize, projectName } from './vocab.ts';

/** Display title for any node; memory text is redacted before titling. */
export function nodeTitle(node: GraphNode): string {
	if (node.kind === 'entity') return node.label;
	return deriveTitle(redactSecrets(node.content ?? node.label));
}

export interface EntityIndex {
	/** Provenance entities (targets of `derived_from`); never drawn as nodes. */
	sources: Set<string>;
	/** Topic entities (targets of `about`). */
	topics: Set<string>;
}

export function classifyEntities(graph: GraphResponse): EntityIndex {
	const sourceTargets = new Set<string>();
	for (const edge of graph.edges) {
		if (edge.type === 'derived_from') sourceTargets.add(edge.to);
	}
	const sources = new Set<string>();
	const topics = new Set<string>();
	for (const node of graph.nodes) {
		if (node.kind !== 'entity') continue;
		if (node.id.startsWith('source:') || sourceTargets.has(node.id)) {
			sources.add(node.id);
		} else {
			topics.add(node.id);
		}
	}
	return { sources, topics };
}

export interface MemoryFacets {
	topics: string[];
	source?: string;
	/** Links to other memories (excluding topics, sources and replacements). */
	links: number;
}

/** Per-memory topic tags, source text and link counts. */
export function memoryFacets(graph: GraphResponse): Map<string, MemoryFacets> {
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const { sources, topics } = classifyEntities(graph);
	const facets = new Map<string, MemoryFacets>();
	const get = (id: string) => {
		let entry = facets.get(id);
		if (!entry) {
			entry = { topics: [], links: 0 };
			facets.set(id, entry);
		}
		return entry;
	};
	for (const edge of graph.edges) {
		const target = byId.get(edge.to);
		if (sources.has(edge.to)) {
			if (target) get(edge.from).source = target.label;
			continue;
		}
		if (topics.has(edge.to)) {
			const entry = get(edge.from);
			if (target && !entry.topics.includes(target.label)) {
				entry.topics.push(target.label);
			}
			continue;
		}
		if (
			edge.type === 'about' ||
			edge.type === 'derived_from' ||
			edge.type === 'supersedes'
		)
			continue;
		if (byId.get(edge.from)?.kind === 'memory' && target?.kind === 'memory') {
			get(edge.from).links += 1;
			get(edge.to).links += 1;
		}
	}
	return facets;
}

export interface MemorySection {
	key: string;
	title: string;
	/** Tooltip, e.g. the full project path. */
	hint?: string;
	tone: 'global' | 'project';
	memories: GraphNode[];
}

function byRecency(a: GraphNode, b: GraphNode): number {
	const rank = (node: GraphNode) => (node.status === 'current' ? 0 : 1);
	return rank(a) - rank(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

/**
 * Groups memory nodes into "About you" followed by one section per project
 * (largest first). Session memories live in their project's section.
 */
export function groupMemories(nodes: readonly GraphNode[]): MemorySection[] {
	const global: GraphNode[] = [];
	const projects = new Map<string, GraphNode[]>();
	for (const node of nodes) {
		if (node.kind !== 'memory') continue;
		if (node.scope === 'global') {
			global.push(node);
			continue;
		}
		const key = node.projectId ?? '';
		const list = projects.get(key) ?? [];
		list.push(node);
		projects.set(key, list);
	}
	const sections: MemorySection[] = [];
	if (global.length > 0) {
		sections.push({
			key: 'global',
			title: 'About you',
			hint: 'Applies everywhere you use Otto',
			tone: 'global',
			memories: global.sort(byRecency),
		});
	}
	const ordered = [...projects].sort(
		(a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
	);
	for (const [projectId, list] of ordered) {
		sections.push({
			key: `project:${projectId}`,
			title: projectId ? projectName(projectId) : 'Other chats',
			hint: projectId || undefined,
			tone: 'project',
			memories: list.sort(byRecency),
		});
	}
	return sections;
}

export interface MemoryCounts {
	total: number;
	global: number;
	projects: Array<{ projectId: string; name: string; count: number }>;
}

/** Counts current memories only (replaced/forgotten ones are history). */
export function countMemories(graph: GraphResponse): MemoryCounts {
	let total = 0;
	let global = 0;
	const projects = new Map<string, number>();
	for (const node of graph.nodes) {
		if (node.kind !== 'memory' || node.status !== 'current') continue;
		total += 1;
		if (node.scope === 'global') {
			global += 1;
		} else {
			const key = node.projectId ?? '';
			projects.set(key, (projects.get(key) ?? 0) + 1);
		}
	}
	return {
		total,
		global,
		projects: [...projects]
			.map(([projectId, count]) => ({
				projectId,
				name: projectId ? projectName(projectId) : 'other chats',
				count,
			}))
			.sort((a, b) => b.count - a.count),
	};
}

/** "3 memories · 1 about you · 2 in agi" */
export function describeCounts(counts: MemoryCounts): string {
	if (counts.total === 0) return 'Nothing remembered yet';
	const parts = [pluralize(counts.total, 'memory', 'memories')];
	if (counts.global > 0) parts.push(`${counts.global} about you`);
	if (counts.projects.length > 2) {
		const inProjects = counts.projects.reduce((sum, p) => sum + p.count, 0);
		parts.push(
			`${inProjects} across ${pluralize(counts.projects.length, 'project', 'projects')}`,
		);
	} else {
		for (const project of counts.projects) {
			parts.push(`${project.count} in ${project.name}`);
		}
	}
	return parts.join(' \u00b7 ');
}

export type MainView = 'list' | 'graph';

/**
 * The map only becomes the default once it has something to show: many
 * memories, or at least a few that are actually linked to each other.
 */
export function chooseView(visible: GraphResponse): MainView {
	const memoryIds = new Set(
		visible.nodes.filter((n) => n.kind === 'memory').map((n) => n.id),
	);
	if (memoryIds.size > 8) return 'graph';
	const linked = visible.edges.some(
		(edge) => memoryIds.has(edge.from) && memoryIds.has(edge.to),
	);
	return memoryIds.size >= 3 && linked ? 'graph' : 'list';
}

export function projectOptions(
	scopes: ScopesResponse | null,
): Array<{ projectId: string; name: string; count: number }> {
	return (scopes?.projects ?? []).map((project) => ({
		projectId: project.projectId,
		name: projectName(project.projectId) || project.label,
		count: project.memoryCount,
	}));
}
