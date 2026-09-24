import { useCallback, useEffect, useRef, useState } from 'react';
import type { HighlightDiff, HighlightKind } from '../graph/model.ts';
import type { ActiveHighlight } from '../graph/renderer.ts';

const DURATION: Record<HighlightKind, number> = {
	pulse: 1400,
	strong: 2200,
	added: 2400,
	removed: 1600,
	search: 0,
};
const EDGE_DURATION = 1800;

export interface Highlights {
	nodes: ReadonlyMap<string, ActiveHighlight>;
	edges: ReadonlyMap<string, ActiveHighlight>;
	flash: (diff: Pick<HighlightDiff, 'nodes' | 'edges'>) => void;
}

/** Time-boxed node/edge highlights; expired entries are pruned automatically. */
export function useHighlights(): Highlights {
	const [nodes, setNodes] = useState<Map<string, ActiveHighlight>>(new Map());
	const [edges, setEdges] = useState<Map<string, ActiveHighlight>>(new Map());
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const prune = useCallback(() => {
		const now = performance.now();
		let remaining = 0;
		const keep = (map: Map<string, ActiveHighlight>) => {
			const next = new Map<string, ActiveHighlight>();
			for (const [id, h] of map) {
				if (now - h.start < h.duration) {
					next.set(id, h);
					remaining += 1;
				}
			}
			return next.size === map.size ? map : next;
		};
		setNodes(keep);
		setEdges(keep);
		timer.current = remaining > 0 ? setTimeout(prune, 250) : null;
	}, []);

	const flash = useCallback(
		(diff: Pick<HighlightDiff, 'nodes' | 'edges'>) => {
			const start = performance.now();
			if (diff.nodes.size > 0) {
				setNodes((prev) => {
					const next = new Map(prev);
					for (const [id, kind] of diff.nodes) {
						next.set(id, { kind, start, duration: DURATION[kind] });
					}
					return next;
				});
			}
			if (diff.edges.size > 0) {
				setEdges((prev) => {
					const next = new Map(prev);
					for (const id of diff.edges) {
						next.set(id, { kind: 'added', start, duration: EDGE_DURATION });
					}
					return next;
				});
			}
			if (!timer.current) timer.current = setTimeout(prune, 250);
		},
		[prune],
	);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	return { nodes, edges, flash };
}
