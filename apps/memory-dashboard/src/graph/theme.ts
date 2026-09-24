import type { EdgeType, MemoryScope } from '../types.ts';

export const SCOPE_COLORS: Record<MemoryScope, string> = {
	global: '#f2b544',
	project: '#43c6e8',
	session: '#b48cff',
};

export const ENTITY_COLOR = '#8d97a8';
export const CANVAS_BG = '#0b0d12';
export const LABEL_COLOR = 'rgba(226, 231, 240, 0.92)';
export const LABEL_MUTED = 'rgba(226, 231, 240, 0.6)';
export const SELECT_COLOR = '#ffffff';
export const HOVER_COLOR = 'rgba(255,255,255,0.7)';
export const SEARCH_COLOR = '#ffd166';

export const HIGHLIGHT_COLORS = {
	pulse: '#43c6e8',
	strong: '#ffffff',
	added: '#5ee3a1',
	removed: '#ff5c5c',
	search: SEARCH_COLOR,
} as const;

export interface EdgeStyle {
	color: string;
	width: number;
	dash: number[];
	arrow: boolean;
}

export const EDGE_STYLES: Record<EdgeType, EdgeStyle> = {
	supersedes: {
		color: 'rgba(200, 208, 220, 0.75)',
		width: 1.6,
		dash: [],
		arrow: true,
	},
	refines: {
		color: 'rgba(94, 227, 161, 0.7)',
		width: 1.3,
		dash: [],
		arrow: true,
	},
	contradicts: {
		color: 'rgba(255, 92, 92, 0.85)',
		width: 1.4,
		dash: [5, 4],
		arrow: false,
	},
	relates_to: {
		color: 'rgba(140, 150, 170, 0.5)',
		width: 1,
		dash: [],
		arrow: false,
	},
	derived_from: {
		color: 'rgba(120, 130, 150, 0.3)',
		width: 0.8,
		dash: [2, 3],
		arrow: true,
	},
	about: {
		color: 'rgba(141, 151, 168, 0.5)',
		width: 0.9,
		dash: [1, 3],
		arrow: false,
	},
};

export const EDGE_SWATCH: Record<EdgeType, string> = {
	supersedes: '#c8d0dc',
	refines: '#5ee3a1',
	contradicts: '#ff5c5c',
	relates_to: '#8c96aa',
	derived_from: '#5c6577',
	about: '#8d97a8',
};
