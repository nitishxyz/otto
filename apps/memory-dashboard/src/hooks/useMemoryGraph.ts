import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import type { GraphResponse, ScopesResponse } from '../types.ts';

const EMPTY_GRAPH: GraphResponse = { nodes: [], edges: [] };
const GRAPH_LIMIT = 500;

export interface MemoryGraphState {
	graph: GraphResponse;
	setGraph: (update: (prev: GraphResponse) => GraphResponse) => void;
	scopes: ScopesResponse | null;
	error: string | null;
	loaded: boolean;
	reload: () => void;
	/** Debounced graph + scopes refetch after a live event. */
	scheduleRefetch: (delay: number) => void;
}

/** Loads `/api/graph` (for the selected project) and `/api/scopes`. */
export function useMemoryGraph(projectId: string | null): MemoryGraphState {
	const [graph, setGraphState] = useState<GraphResponse>(EMPTY_GRAPH);
	const [scopes, setScopes] = useState<ScopesResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const loadScopes = useCallback(async () => {
		try {
			setScopes(await api.scopes());
		} catch {
			// optional: the project selector just stays empty
		}
	}, []);

	const loadGraph = useCallback(async (project: string | null) => {
		try {
			const data = await api.graph({
				projectId: project ?? undefined,
				includeSuperseded: true,
				limit: GRAPH_LIMIT,
			});
			setGraphState({ nodes: data.nodes ?? [], edges: data.edges ?? [] });
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'unavailable');
		} finally {
			setLoaded(true);
		}
	}, []);

	useEffect(() => {
		void loadScopes();
	}, [loadScopes]);

	useEffect(() => {
		void loadGraph(projectId);
	}, [loadGraph, projectId]);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	const scheduleRefetch = useCallback(
		(delay: number) => {
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => {
				timer.current = null;
				void loadGraph(projectId);
				void loadScopes();
			}, delay);
		},
		[loadGraph, loadScopes, projectId],
	);

	const reload = useCallback(() => {
		void loadGraph(projectId);
		void loadScopes();
	}, [loadGraph, loadScopes, projectId]);

	return {
		graph,
		setGraph: setGraphState,
		scopes,
		error,
		loaded,
		reload,
		scheduleRefetch,
	};
}
