import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
	type WheelEvent as ReactWheelEvent,
} from 'react';
import type { LayoutInputs } from './model.ts';
import {
	hitTest,
	renderGraph,
	screenToWorld,
	type ActiveHighlight,
	type ViewTransform,
} from './renderer.ts';
import { createGraphSimulation, type SimNode } from './simulation.ts';
import { GraphTooltip } from './GraphTooltip.tsx';

export interface GraphCanvasProps {
	inputs: LayoutInputs;
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	searchIds: ReadonlySet<string>;
	nodeHighlights: ReadonlyMap<string, ActiveHighlight>;
	edgeHighlights: ReadonlyMap<string, ActiveHighlight>;
	focus: { ids: string[]; key: number } | null;
	/** Changing this re-fits the view to the content. */
	fitKey: string;
}

interface DragState {
	startX: number;
	startY: number;
	originX: number;
	originY: number;
	node: SimNode | null;
	moved: boolean;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 5;

export function GraphCanvas(props: GraphCanvasProps) {
	const {
		inputs,
		selectedId,
		onSelect,
		searchIds,
		nodeHighlights,
		edgeHighlights,
		focus,
		fitKey,
	} = props;
	const containerRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const sim = useMemo(() => createGraphSimulation(), []);
	const transformRef = useRef<ViewTransform>({ k: 1, x: 0, y: 0 });
	const targetRef = useRef<ViewTransform | null>(null);
	const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
	const hoverRef = useRef<string | null>(null);
	const dragRef = useRef<DragState | null>(null);
	const dirtyRef = useRef(true);
	const fittedRef = useRef(false);
	const userMovedRef = useRef(false);
	const propsRef = useRef({
		selectedId,
		searchIds,
		nodeHighlights,
		edgeHighlights,
	});
	const prev = propsRef.current;
	if (
		prev.selectedId !== selectedId ||
		prev.searchIds !== searchIds ||
		prev.nodeHighlights !== nodeHighlights ||
		prev.edgeHighlights !== edgeHighlights
	) {
		propsRef.current = {
			selectedId,
			searchIds,
			nodeHighlights,
			edgeHighlights,
		};
		dirtyRef.current = true;
	}
	const [tooltip, setTooltip] = useState<{
		node: SimNode;
		x: number;
		y: number;
	} | null>(null);

	useEffect(() => {
		sim.update(inputs);
		dirtyRef.current = true;
	}, [sim, inputs]);

	useEffect(() => {
		if (!focus || focus.ids.length === 0) return;
		const hits = focus.ids
			.map((id) => sim.byId.get(id))
			.filter((node): node is SimNode => Boolean(node));
		if (hits.length === 0) return;
		const cx = hits.reduce((sum, node) => sum + node.x, 0) / hits.length;
		const cy = hits.reduce((sum, node) => sum + node.y, 0) / hits.length;
		const { width, height } = sizeRef.current;
		const k = Math.max(transformRef.current.k, 1.1);
		targetRef.current = { k, x: width / 2 - cx * k, y: height / 2 - cy * k };
		userMovedRef.current = true;
		dirtyRef.current = true;
	}, [focus, sim]);

	const fitToContent = useCallback(() => {
		const nodes = sim.nodes;
		const { width, height } = sizeRef.current;
		if (nodes.length === 0 || width === 0 || height === 0) return;
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const node of nodes) {
			minX = Math.min(minX, node.x - node.radius);
			minY = Math.min(minY, node.y - node.radius);
			maxX = Math.max(maxX, node.x + node.radius);
			maxY = Math.max(maxY, node.y + node.radius);
		}
		// Labels hang below nodes; the legend and hint sit along the bottom.
		const pad = { x: 90, top: 56, bottom: 120 };
		const w = Math.max(1, maxX - minX);
		const h = Math.max(1, maxY - minY);
		const availW = Math.max(1, width - pad.x * 2);
		const availH = Math.max(1, height - pad.top - pad.bottom);
		const k = Math.min(
			MAX_ZOOM,
			Math.max(MIN_ZOOM, Math.min(availW / w, availH / h, 1.6)),
		);
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		targetRef.current = {
			k,
			x: width / 2 - cx * k,
			y: pad.top + availH / 2 - cy * k,
		};
		dirtyRef.current = true;
	}, [sim]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: fitKey is the trigger
	useEffect(() => {
		userMovedRef.current = false;
		fittedRef.current = false;
		fitToContent();
	}, [fitKey, fitToContent]);

	useEffect(() => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (!container || !canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const resize = () => {
			const rect = container.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			const width = Math.max(1, Math.floor(rect.width));
			const height = Math.max(1, Math.floor(rect.height));
			const prev = sizeRef.current;
			if (prev.width === 0 && prev.height === 0) {
				transformRef.current = { k: 1, x: width / 2, y: height / 2 };
			} else if (prev.width !== width || prev.height !== height) {
				const t = transformRef.current;
				transformRef.current = {
					k: t.k,
					x: t.x + (width - prev.width) / 2,
					y: t.y + (height - prev.height) / 2,
				};
			}
			sizeRef.current = { width, height, dpr };
			canvas.width = width * dpr;
			canvas.height = height * dpr;
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			dirtyRef.current = true;
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(container);

		let frame = 0;
		let ticks = 0;
		const loop = () => {
			frame = requestAnimationFrame(loop);
			const ticked = sim.tick();
			if (ticked) ticks += 1;
			if (!fittedRef.current && sim.nodes.length > 0 && !userMovedRef.current) {
				if (!ticked) {
					fitToContent();
					fittedRef.current = true;
				} else if (ticks % 30 === 0) {
					fitToContent();
				}
			}
			let animating = false;
			const target = targetRef.current;
			if (target) {
				const t = transformRef.current;
				const next = {
					k: t.k + (target.k - t.k) * 0.18,
					x: t.x + (target.x - t.x) * 0.18,
					y: t.y + (target.y - t.y) * 0.18,
				};
				const done =
					Math.abs(next.k - target.k) < 0.001 &&
					Math.abs(next.x - target.x) < 0.3 &&
					Math.abs(next.y - target.y) < 0.3;
				transformRef.current = done ? target : next;
				if (done) targetRef.current = null;
				animating = true;
			}
			const { nodeHighlights, edgeHighlights, selectedId, searchIds } =
				propsRef.current;
			const live = nodeHighlights.size > 0 || edgeHighlights.size > 0;
			if (!ticked && !animating && !live && !dirtyRef.current) return;
			dirtyRef.current = false;
			const { width, height, dpr } = sizeRef.current;
			renderGraph(ctx, sim.nodes, sim.links, {
				width,
				height,
				dpr,
				transform: transformRef.current,
				hoverId: hoverRef.current,
				selectedId,
				searchIds,
				nodeHighlights,
				edgeHighlights,
				nodeCount: sim.nodes.length,
				now: performance.now(),
			});
		};
		frame = requestAnimationFrame(loop);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, [sim, fitToContent]);

	useEffect(() => () => sim.stop(), [sim]);

	const localPoint = (event: ReactMouseEvent) => {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	};

	const onMouseDown = (event: ReactMouseEvent<HTMLCanvasElement>) => {
		if (event.button !== 0) return;
		const { x, y } = localPoint(event);
		const node = hitTest(sim.nodes, transformRef.current, x, y);
		dragRef.current = {
			startX: x,
			startY: y,
			originX: transformRef.current.x,
			originY: transformRef.current.y,
			node,
			moved: false,
		};
		if (node) {
			node.fx = node.x;
			node.fy = node.y;
		}
	};

	const onMouseMove = (event: ReactMouseEvent<HTMLCanvasElement>) => {
		const { x, y } = localPoint(event);
		const drag = dragRef.current;
		if (drag) {
			const dx = x - drag.startX;
			const dy = y - drag.startY;
			if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
			if (drag.node) {
				const world = screenToWorld(transformRef.current, x, y);
				drag.node.fx = world.x;
				drag.node.fy = world.y;
				sim.reheat(0.25);
			} else {
				targetRef.current = null;
				userMovedRef.current = true;
				transformRef.current = {
					k: transformRef.current.k,
					x: drag.originX + dx,
					y: drag.originY + dy,
				};
			}
			dirtyRef.current = true;
			return;
		}
		const node = hitTest(sim.nodes, transformRef.current, x, y);
		const nextId = node?.id ?? null;
		if (nextId !== hoverRef.current) {
			hoverRef.current = nextId;
			dirtyRef.current = true;
		}
		event.currentTarget.style.cursor = node ? 'pointer' : '';
		setTooltip(node ? { node, x, y } : null);
	};

	const endDrag = () => {
		const drag = dragRef.current;
		if (!drag) return;
		dragRef.current = null;
		if (drag.node) {
			drag.node.fx = null;
			drag.node.fy = null;
		}
		if (!drag.moved) onSelect(drag.node ? drag.node.id : null);
	};

	const onMouseLeave = () => {
		hoverRef.current = null;
		setTooltip(null);
		endDrag();
		dirtyRef.current = true;
	};

	const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
		const { x, y } = localPoint(event);
		const t = transformRef.current;
		const factor = Math.exp(-event.deltaY * 0.0015);
		const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * factor));
		const world = screenToWorld(t, x, y);
		targetRef.current = null;
		userMovedRef.current = true;
		transformRef.current = { k, x: x - world.x * k, y: y - world.y * k };
		dirtyRef.current = true;
	};

	const onDoubleClick = () => {
		userMovedRef.current = false;
		fitToContent();
	};

	return (
		<div className="graph-stage" ref={containerRef}>
			<canvas
				ref={canvasRef}
				className="graph-canvas"
				onMouseDown={onMouseDown}
				onMouseMove={onMouseMove}
				onMouseUp={endDrag}
				onMouseLeave={onMouseLeave}
				onWheel={onWheel}
				onDoubleClick={onDoubleClick}
			/>
			{tooltip ? (
				<GraphTooltip node={tooltip.node.node} x={tooltip.x} y={tooltip.y} />
			) : null}
		</div>
	);
}
