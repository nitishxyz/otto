/**
 * Geometry for the custom-drawn "otto" wordmark, mirroring
 * `apps/landing/src/components/neopop/NeoOttoLogo.tsx`.
 *
 * The landing component paints with CSS custom properties and Tailwind, neither
 * of which Satori resolves, so the maths lives here too. Keep the metric grid
 * and the two glyph builders in sync with that file; the paths are emitted with
 * their offset baked in so no `transform` is needed on the rendered groups.
 */

type Point = [number, number];

/* Metric grid (SVG user units). */
const BASELINE = 56;
const X_HEIGHT_TOP = 20;
const ASCENDER_TOP = 8;
const WEIGHT = 10;
const O_WIDTH = 40;
const GAP = 12;

export const WORDMARK_PAD = 2;
export const WORDMARK_ASCENDER_TOP = ASCENDER_TOP;

/** Crossbar sits on the x-height line so `t` and `o` share a shoulder. */
const CROSS_TOP = X_HEIGHT_TOP;
const CROSS_BOTTOM = CROSS_TOP + WEIGHT;
/** Asymmetric arms plus a bottom-right foot keep the `t` from reading as a +. */
const CROSS_LEFT_ARM = 5;
const CROSS_RIGHT_ARM = 8;
const FOOT_WIDTH = 9;

const fmt = (value: number) => Number(value.toFixed(2)).toString();

/** Traces a closed polygon, softening each vertex with a quadratic corner. */
function roundedPolygon(points: Point[], radius: number): string {
	const count = points.length;
	let d = '';

	for (let i = 0; i < count; i++) {
		const prev = points[(i - 1 + count) % count];
		const current = points[i];
		const next = points[(i + 1) % count];

		const inX = current[0] - prev[0];
		const inY = current[1] - prev[1];
		const outX = next[0] - current[0];
		const outY = next[1] - current[1];
		const inLength = Math.hypot(inX, inY);
		const outLength = Math.hypot(outX, outY);
		const r = Math.min(radius, inLength / 2, outLength / 2);

		const startX = current[0] - (inX / inLength) * r;
		const startY = current[1] - (inY / inLength) * r;
		const endX = current[0] + (outX / outLength) * r;
		const endY = current[1] + (outY / outLength) * r;

		d += `${i === 0 ? 'M' : 'L'}${fmt(startX)} ${fmt(startY)}`;
		if (r > 0) {
			d += `Q${fmt(current[0])} ${fmt(current[1])} ${fmt(endX)} ${fmt(endY)}`;
		}
	}

	return `${d}Z`;
}

function rect(x: number, y: number, w: number, h: number): Point[] {
	return [
		[x, y],
		[x + w, y],
		[x + w, y + h],
		[x, y + h],
	];
}

/** Outer ring of the square-countered `o`. */
function oOuter(x: number, dy: number): string {
	return roundedPolygon(
		rect(x, X_HEIGHT_TOP + dy, O_WIDTH, BASELINE - X_HEIGHT_TOP),
		7,
	);
}

/** Counter of the `o`, drawn as its own shape so no fill rule is needed. */
function oCounter(x: number, dy: number): string {
	return roundedPolygon(
		rect(
			x + WEIGHT,
			X_HEIGHT_TOP + WEIGHT + dy,
			O_WIDTH - WEIGHT * 2,
			BASELINE - X_HEIGHT_TOP - WEIGHT * 2,
		),
		3,
	);
}

/**
 * Single-outline `t`: ascending stem, a short crossbar weighted to the right,
 * and an L-shaped foot that turns right on the baseline.
 */
function tGlyph(stemX: number, dy: number): string {
	const stemRight = stemX + WEIGHT;
	const barRight = stemRight + CROSS_RIGHT_ARM;
	const barLeft = stemX - CROSS_LEFT_ARM;
	const footRight = stemRight + FOOT_WIDTH;
	const footTop = BASELINE - WEIGHT + dy;

	return roundedPolygon(
		[
			[stemX, ASCENDER_TOP + dy],
			[stemRight, ASCENDER_TOP + dy],
			[stemRight, CROSS_TOP + dy],
			[barRight, CROSS_TOP + dy],
			[barRight, CROSS_BOTTOM + dy],
			[stemRight, CROSS_BOTTOM + dy],
			[stemRight, footTop],
			[footRight, footTop],
			[footRight, BASELINE + dy],
			[stemX, BASELINE + dy],
			[stemX, CROSS_BOTTOM + dy],
			[barLeft, CROSS_BOTTOM + dy],
			[barLeft, CROSS_TOP + dy],
			[stemX, CROSS_TOP + dy],
		],
		3,
	);
}

const O_ONE_X = 0;
const T_ONE_STEM = O_ONE_X + O_WIDTH + GAP + CROSS_LEFT_ARM;
const T_ONE_RIGHT = T_ONE_STEM + WEIGHT + Math.max(CROSS_RIGHT_ARM, FOOT_WIDTH);
const T_TWO_STEM = T_ONE_RIGHT + GAP + CROSS_LEFT_ARM;
const T_TWO_RIGHT = T_TWO_STEM + WEIGHT + Math.max(CROSS_RIGHT_ARM, FOOT_WIDTH);
const O_TWO_X = T_TWO_RIGHT + GAP;

export const WORDMARK_WIDTH = O_TWO_X + O_WIDTH;
export const WORDMARK_HEIGHT = BASELINE - ASCENDER_TOP;

export type WordmarkLetter = 'o1' | 't1' | 't2' | 'o2';

export interface WordmarkShape {
	key: string;
	letter: WordmarkLetter;
	d: string;
	/** Counters are knocked out with the page background, not a fill rule. */
	counter: boolean;
}

/** Every shape of the wordmark, shifted by `dx`/`dy` grid units. */
export function wordmarkShapes(dx = 0, dy = 0): WordmarkShape[] {
	return [
		{ key: 'o1', letter: 'o1', d: oOuter(O_ONE_X + dx, dy), counter: false },
		{
			key: 'o1c',
			letter: 'o1',
			d: oCounter(O_ONE_X + dx, dy),
			counter: true,
		},
		{ key: 't1', letter: 't1', d: tGlyph(T_ONE_STEM + dx, dy), counter: false },
		{ key: 't2', letter: 't2', d: tGlyph(T_TWO_STEM + dx, dy), counter: false },
		{ key: 'o2', letter: 'o2', d: oOuter(O_TWO_X + dx, dy), counter: false },
		{
			key: 'o2c',
			letter: 'o2',
			d: oCounter(O_TWO_X + dx, dy),
			counter: true,
		},
	];
}
