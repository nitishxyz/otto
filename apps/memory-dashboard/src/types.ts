export type MemoryScope = 'global' | 'project' | 'session';
export type MemoryStatus = 'current' | 'superseded' | 'forgotten';
export type MemoryOrigin = 'explicit' | 'inferred';
export type NodeKind = 'memory' | 'entity';

export type EdgeType =
	| 'supersedes'
	| 'refines'
	| 'contradicts'
	| 'relates_to'
	| 'derived_from'
	| 'about';
export type EdgeOrigin = 'explicit' | 'typesafe' | 'code';

export interface GraphNode {
	id: string;
	kind: NodeKind;
	label: string;
	content?: string;
	scope: MemoryScope;
	projectId?: string;
	status: MemoryStatus;
	origin: MemoryOrigin;
	createdAt: string;
	updatedAt: string;
	source?: { sessionId?: string; messageId?: string; agent?: string };
}

export interface GraphEdge {
	id: string;
	from: string;
	to: string;
	type: EdgeType;
	origin: EdgeOrigin;
	score?: number;
	createdAt: string;
}

export interface GraphResponse {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export interface MemoryDetailResponse {
	memory: GraphNode;
	edges: GraphEdge[];
	lineage: GraphNode[];
	neighbors: GraphNode[];
}

export type MemoryEventType =
	| 'recall'
	| 'capture'
	| 'remember'
	| 'update'
	| 'forget'
	| 'link';

export interface MemoryEvent {
	id: string;
	at: string;
	type: MemoryEventType;
	agent: string;
	sessionId?: string;
	projectId?: string;
	scope?: MemoryScope;
	memoryIds: string[];
	query?: string;
	ranking?: 'typesafe' | 'fts';
	injectedIds?: string[];
	details?: unknown;
}

export interface ActivityResponse {
	events: MemoryEvent[];
}

export interface ScopesResponse {
	projects: Array<{ projectId: string; label: string; memoryCount: number }>;
	globalCount: number;
}

export interface SearchResponse {
	nodes: GraphNode[];
}

export const EDGE_TYPES: readonly EdgeType[] = [
	'supersedes',
	'refines',
	'contradicts',
	'relates_to',
	'derived_from',
	'about',
];

export const SCOPES: readonly MemoryScope[] = ['global', 'project', 'session'];
