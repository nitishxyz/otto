import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from 'd3-force';
import type { LayoutInputs, LayoutLink, LayoutNode } from './model.ts';

export interface SimNode extends SimulationNodeDatum, LayoutNode {
	x: number;
	y: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
	id: string;
	link: LayoutLink;
	source: SimNode;
	target: SimNode;
}

export interface GraphSimulation {
	nodes: SimNode[];
	links: SimLink[];
	byId: Map<string, SimNode>;
	update(inputs: LayoutInputs): void;
	tick(): boolean;
	reheat(alpha?: number): void;
	stop(): void;
}

/**
 * Owns a d3-force simulation and keeps node positions stable across data
 * refreshes so live updates do not scramble the layout.
 */
export function createGraphSimulation(): GraphSimulation {
	const byId = new Map<string, SimNode>();
	let nodes: SimNode[] = [];
	let links: SimLink[] = [];
	const linkForce = forceLink<SimNode, SimLink>([])
		.id((node) => node.id)
		.distance((link) => link.link.distance)
		.strength((link) => link.link.strength);
	const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode>([])
		.force('link', linkForce)
		.force('charge', forceManyBody<SimNode>().strength(-140).distanceMax(420))
		.force(
			'collide',
			forceCollide<SimNode>()
				.radius((node) => node.radius + 4)
				.strength(0.8),
		)
		.force('x', forceX<SimNode>(0).strength(0.02))
		.force('y', forceY<SimNode>(0).strength(0.02))
		.force('center', forceCenter(0, 0).strength(0.05))
		.alphaDecay(0.035)
		.velocityDecay(0.35)
		.stop();

	function seedPosition(index: number, total: number) {
		const angle = (index / Math.max(1, total)) * Math.PI * 2;
		const spread = 40 + Math.sqrt(total) * 14;
		return {
			x: Math.cos(angle) * spread + (Math.random() - 0.5) * 20,
			y: Math.sin(angle) * spread + (Math.random() - 0.5) * 20,
		};
	}

	const api: GraphSimulation = {
		get nodes() {
			return nodes;
		},
		get links() {
			return links;
		},
		byId,
		update(inputs) {
			const keep = new Set<string>();
			const next: SimNode[] = inputs.nodes.map((layout, index) => {
				keep.add(layout.id);
				const existing = byId.get(layout.id);
				if (existing) {
					existing.node = layout.node;
					existing.label = layout.label;
					existing.degree = layout.degree;
					existing.radius = layout.radius;
					return existing;
				}
				const neighbor = findAnchor(layout.id, inputs, byId);
				const seed = neighbor
					? {
							x: neighbor.x + (Math.random() - 0.5) * 30,
							y: neighbor.y + (Math.random() - 0.5) * 30,
						}
					: seedPosition(index, inputs.nodes.length);
				const created: SimNode = { ...layout, ...seed };
				byId.set(layout.id, created);
				return created;
			});
			for (const id of [...byId.keys()]) {
				if (!keep.has(id)) byId.delete(id);
			}
			nodes = next;
			links = inputs.links.flatMap((link) => {
				const source = byId.get(link.source);
				const target = byId.get(link.target);
				if (!source || !target) return [];
				return [{ id: link.id, link, source, target }];
			});
			sim.nodes(nodes);
			linkForce.links(links);
			sim.alpha(Math.max(sim.alpha(), 0.6)).alphaTarget(0);
		},
		tick() {
			if (sim.alpha() < sim.alphaMin()) return false;
			sim.tick();
			return true;
		},
		reheat(alpha = 0.3) {
			sim.alpha(Math.max(sim.alpha(), alpha));
		},
		stop() {
			sim.stop();
		},
	};
	return api;
}

function findAnchor(
	id: string,
	inputs: LayoutInputs,
	byId: Map<string, SimNode>,
): SimNode | undefined {
	for (const link of inputs.links) {
		if (link.source === id) {
			const hit = byId.get(link.target);
			if (hit) return hit;
		} else if (link.target === id) {
			const hit = byId.get(link.source);
			if (hit) return hit;
		}
	}
	return undefined;
}
