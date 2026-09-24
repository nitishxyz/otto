import type { HighlightKind } from './model.ts';
import type { SimLink, SimNode } from './simulation.ts';
import {
	CANVAS_BG,
	EDGE_STYLES,
	ENTITY_COLOR,
	HIGHLIGHT_COLORS,
	HOVER_COLOR,
	LABEL_COLOR,
	LABEL_MUTED,
	SCOPE_COLORS,
	SEARCH_COLOR,
	SELECT_COLOR,
} from './theme.ts';

export interface ViewTransform {
	k: number;
	x: number;
	y: number;
}

export interface ActiveHighlight {
	kind: HighlightKind;
	start: number;
	duration: number;
}

export interface RenderState {
	width: number;
	height: number;
	dpr: number;
	transform: ViewTransform;
	hoverId: string | null;
	selectedId: string | null;
	searchIds: ReadonlySet<string>;
	nodeHighlights: ReadonlyMap<string, ActiveHighlight>;
	edgeHighlights: ReadonlyMap<string, ActiveHighlight>;
	nodeCount: number;
	now: number;
}

export function worldToScreen(t: ViewTransform, x: number, y: number) {
	return { x: x * t.k + t.x, y: y * t.k + t.y };
}

export function screenToWorld(t: ViewTransform, x: number, y: number) {
	return { x: (x - t.x) / t.k, y: (y - t.y) / t.k };
}

export function hitTest(
	nodes: readonly SimNode[],
	t: ViewTransform,
	sx: number,
	sy: number,
): SimNode | null {
	const { x, y } = screenToWorld(t, sx, sy);
	let best: SimNode | null = null;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const node of nodes) {
		const dx = node.x - x;
		const dy = node.y - y;
		const dist = Math.hypot(dx, dy);
		const hitRadius = node.radius + 4 / t.k;
		if (dist <= hitRadius && dist < bestDist) {
			best = node;
			bestDist = dist;
		}
	}
	return best;
}

function nodeAlpha(node: SimNode): number {
	if (node.node.status === 'forgotten') return 0.18;
	if (node.node.status === 'superseded') return 0.42;
	return 1;
}

function nodeColor(node: SimNode): string {
	if (node.node.kind === 'entity') return ENTITY_COLOR;
	return SCOPE_COLORS[node.node.scope] ?? ENTITY_COLOR;
}

function progress(h: ActiveHighlight, now: number): number {
	return Math.min(1, Math.max(0, (now - h.start) / h.duration));
}

function drawArrowHead(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	angle: number,
	size: number,
) {
	ctx.beginPath();
	ctx.moveTo(x, y);
	ctx.lineTo(
		x - size * Math.cos(angle - Math.PI / 7),
		y - size * Math.sin(angle - Math.PI / 7),
	);
	ctx.lineTo(
		x - size * Math.cos(angle + Math.PI / 7),
		y - size * Math.sin(angle + Math.PI / 7),
	);
	ctx.closePath();
	ctx.fill();
}

function drawEdge(
	ctx: CanvasRenderingContext2D,
	link: SimLink,
	state: RenderState,
) {
	const style = EDGE_STYLES[link.link.edge.type];
	const { source, target } = link;
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const len = Math.hypot(dx, dy) || 1;
	const ux = dx / len;
	const uy = dy / len;
	const startX = source.x + ux * source.radius;
	const startY = source.y + uy * source.radius;
	const endX = target.x - ux * (target.radius + (style.arrow ? 2 : 0));
	const endY = target.y - uy * (target.radius + (style.arrow ? 2 : 0));

	const flash = state.edgeHighlights.get(link.id);
	const alphaScale = Math.min(nodeAlpha(source), nodeAlpha(target));
	const isTouched =
		state.hoverId === source.id ||
		state.hoverId === target.id ||
		state.selectedId === source.id ||
		state.selectedId === target.id;

	ctx.save();
	ctx.globalAlpha = alphaScale * (isTouched ? 1 : 0.9);
	ctx.strokeStyle = style.color;
	ctx.lineWidth =
		(isTouched ? style.width + 0.8 : style.width) / state.transform.k;
	ctx.setLineDash(style.dash.map((d) => d / state.transform.k));
	ctx.beginPath();
	ctx.moveTo(startX, startY);
	ctx.lineTo(endX, endY);
	ctx.stroke();
	ctx.setLineDash([]);
	if (style.arrow) {
		ctx.fillStyle = style.color;
		drawArrowHead(ctx, endX, endY, Math.atan2(uy, ux), 7 / state.transform.k);
	}
	if (flash) {
		const p = progress(flash, state.now);
		ctx.globalAlpha = (1 - p) * 0.9;
		ctx.strokeStyle = HIGHLIGHT_COLORS.added;
		ctx.lineWidth = (style.width + 3 * (1 - p)) / state.transform.k;
		ctx.beginPath();
		ctx.moveTo(startX, startY);
		ctx.lineTo(endX, endY);
		ctx.stroke();
	}
	ctx.restore();
}

function drawRing(
	ctx: CanvasRenderingContext2D,
	node: SimNode,
	radius: number,
	color: string,
	width: number,
	alpha: number,
	dash: number[] = [],
) {
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.setLineDash(dash);
	ctx.beginPath();
	ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
	ctx.stroke();
	ctx.restore();
}

function drawNodeShape(
	ctx: CanvasRenderingContext2D,
	node: SimNode,
	radius: number,
) {
	ctx.beginPath();
	if (node.node.kind === 'entity') {
		ctx.moveTo(node.x, node.y - radius);
		ctx.lineTo(node.x + radius, node.y);
		ctx.lineTo(node.x, node.y + radius);
		ctx.lineTo(node.x - radius, node.y);
		ctx.closePath();
	} else {
		ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
	}
}

function drawNode(
	ctx: CanvasRenderingContext2D,
	node: SimNode,
	state: RenderState,
) {
	const k = state.transform.k;
	const alpha = nodeAlpha(node);
	const color = nodeColor(node);
	const isSelected = state.selectedId === node.id;
	const isHover = state.hoverId === node.id;
	const highlight = state.nodeHighlights.get(node.id);
	const isSearch = state.searchIds.has(node.id);

	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.fillStyle = color;
	drawNodeShape(ctx, node, node.radius);
	ctx.fill();
	if (node.node.origin === 'inferred' && node.node.kind === 'memory') {
		ctx.globalAlpha = alpha * 0.55;
		ctx.fillStyle = CANVAS_BG;
		ctx.beginPath();
		ctx.arc(node.x, node.y, node.radius * 0.45, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();

	if (node.node.status === 'superseded') {
		drawRing(ctx, node, node.radius + 2.5 / k, color, 1 / k, 0.5, [
			3 / k,
			3 / k,
		]);
	}
	if (isSearch) {
		drawRing(ctx, node, node.radius + 3.5 / k, SEARCH_COLOR, 2 / k, 0.95);
	}
	if (isSelected) {
		drawRing(ctx, node, node.radius + 3 / k, SELECT_COLOR, 2 / k, 1);
	} else if (isHover) {
		drawRing(ctx, node, node.radius + 2.5 / k, HOVER_COLOR, 1.5 / k, 1);
	}
	if (highlight) {
		const p = progress(highlight, state.now);
		const hlColor = HIGHLIGHT_COLORS[highlight.kind];
		if (highlight.kind === 'removed') {
			drawRing(ctx, node, node.radius + 2 / k, hlColor, 2 / k, 1 - p);
		} else {
			const ripple = node.radius + (4 + 18 * p) / k;
			drawRing(ctx, node, ripple, hlColor, (2.5 * (1 - p) + 0.5) / k, 1 - p);
			const wave2 = Math.max(0, p - 0.25) / 0.75;
			if (highlight.kind === 'strong' || highlight.kind === 'added') {
				drawRing(
					ctx,
					node,
					node.radius + (4 + 14 * wave2) / k,
					hlColor,
					(2 * (1 - wave2) + 0.5) / k,
					(1 - wave2) * 0.9,
				);
			}
		}
	}
}

interface LabelPlan {
	node: SimNode;
	text: string;
	focus: boolean;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

function isFocusNode(node: SimNode, state: RenderState): boolean {
	return (
		state.hoverId === node.id ||
		state.selectedId === node.id ||
		state.searchIds.has(node.id) ||
		state.nodeHighlights.has(node.id)
	);
}

function labelFont(focus: boolean, k: number): string {
	return `${focus ? 600 : 400} ${(focus ? 12 : 11) / k}px ui-sans-serif, system-ui, sans-serif`;
}

function planLabel(
	ctx: CanvasRenderingContext2D,
	node: SimNode,
	state: RenderState,
): LabelPlan | null {
	const k = state.transform.k;
	const focus = isFocusNode(node, state);
	const crowded = state.nodeCount > 40;
	if (!focus && crowded && k < 0.9 && node.radius < 11) return null;
	const max = focus ? 48 : 26;
	const text =
		node.label.length > max
			? `${node.label.slice(0, max - 1).trimEnd()}\u2026`
			: node.label;
	ctx.font = labelFont(focus, k);
	const width = ctx.measureText(text).width;
	const y0 = node.y + node.radius + 4 / k;
	return {
		node,
		text,
		focus,
		x0: node.x - width / 2 - 3 / k,
		x1: node.x + width / 2 + 3 / k,
		y0,
		y1: y0 + 15 / k,
	};
}

function overlaps(a: LabelPlan, b: LabelPlan): boolean {
	return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function drawLabel(
	ctx: CanvasRenderingContext2D,
	plan: LabelPlan,
	state: RenderState,
) {
	const k = state.transform.k;
	ctx.save();
	ctx.globalAlpha = Math.max(nodeAlpha(plan.node), 0.55);
	ctx.font = labelFont(plan.focus, k);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	ctx.lineJoin = 'round';
	ctx.lineWidth = 3 / k;
	ctx.strokeStyle = CANVAS_BG;
	ctx.strokeText(plan.text, plan.node.x, plan.y0);
	ctx.fillStyle = plan.focus ? LABEL_COLOR : LABEL_MUTED;
	ctx.fillText(plan.text, plan.node.x, plan.y0);
	ctx.restore();
}

/**
 * Focused labels (hover/selection/search/live) always show; the rest are
 * placed biggest-node-first and skipped when they would overlap, so labels
 * stay readable instead of piling up. Hover reveals the full text.
 */
function drawLabels(
	ctx: CanvasRenderingContext2D,
	nodes: readonly SimNode[],
	state: RenderState,
) {
	const focused: LabelPlan[] = [];
	const others: LabelPlan[] = [];
	for (const node of nodes) {
		const plan = planLabel(ctx, node, state);
		if (!plan) continue;
		(plan.focus ? focused : others).push(plan);
	}
	others.sort((a, b) => b.node.radius - a.node.radius);
	const placed: LabelPlan[] = [...focused];
	const accepted: LabelPlan[] = [];
	for (const plan of others) {
		if (placed.some((other) => overlaps(plan, other))) continue;
		placed.push(plan);
		accepted.push(plan);
	}
	for (const plan of accepted) drawLabel(ctx, plan, state);
	for (const plan of focused) drawLabel(ctx, plan, state);
}

export function renderGraph(
	ctx: CanvasRenderingContext2D,
	nodes: readonly SimNode[],
	links: readonly SimLink[],
	state: RenderState,
) {
	const { width, height, dpr, transform } = state;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = CANVAS_BG;
	ctx.fillRect(0, 0, width, height);
	ctx.translate(transform.x, transform.y);
	ctx.scale(transform.k, transform.k);

	for (const link of links) drawEdge(ctx, link, state);
	for (const node of nodes) drawNode(ctx, node, state);
	drawLabels(ctx, nodes, state);
}
