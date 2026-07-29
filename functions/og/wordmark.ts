/**
 * Geometry for the custom-drawn "otto" wordmark, mirroring
 * `apps/landing/src/components/neopop/NeoOttoLogo.tsx`.
 *
 * The landing component paints with CSS custom properties, which Satori does
 * not resolve, so the palette is re-declared on the OG side. The geometry is
 * identical — keep the metric grid and the two glyph builders in sync.
 */

type Point = [number, number];

/* Metric grid (SVG user units). */
const BASELINE = 56;
const X_HEIGHT_TOP = 20;
const ASCENDER_TOP = 8;
const WEIGHT = 10;
const O_WIDTH = 40;
const GAP = 12;
const PAD = 2;

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

/** Square-countered `o`: outer ring plus a reversed counter, drawn even-odd. */
function oGlyph(x: number): string {
	const outer = roundedPolygon(
		rect(x, X_HEIGHT_TOP, O_WIDTH, BASELINE - X_HEIGHT_TOP),
		7,
	);
	const counter = roundedPolygon(
		rect(
			x + WEIGHT,
			X_HEIGHT_TOP + WEIGHT,
			O_WIDTH - WEIGHT * 2,
			BASELINE - X_HEIGHT_TOP - WEIGHT * 2,
		),
		3,
	);
	return `${outer} ${counter}`;
}

/**
 * Single-outline `t`: ascending stem, a short crossbar weighted to the right,
 * and an L-shaped foot that turns right on the baseline.
 */
function tGlyph(stemX: number): string {
	const stemRight = stemX + WEIGHT;
	const barRight = stemRight + CROSS_RIGHT_ARM;
	const barLeft = stemX - CROSS_LEFT_ARM;
	const footRight = stemRight + FOOT_WIDTH;
	const footTop = BASELINE - WEIGHT;

	return roundedPolygon(
		[
			[stemX, ASCENDER_TOP],
			[stemRight, ASCENDER_TOP],
			[stemRight, CROSS_TOP],
			[barRight, CROSS_TOP],
			[barRight, CROSS_BOTTOM],
			[stemRight, CROSS_BOTTOM],
			[stemRight, footTop],
			[footRight, footTop],
			[footRight, BASELINE],
			[stemX, BASELINE],
			[stemX, CROSS_BOTTOM],
			[barLeft, CROSS_BOTTOM],
			[barLeft, CROSS_TOP],
			[stemX, CROSS_TOP],
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

const WORD_WIDTH = O_TWO_X + O_WIDTH;

export const WORDMARK_PAD = PAD;
export const WORDMARK_ASCENDER_TOP = ASCENDER_TOP;
export const WORDMARK_WIDTH = WORD_WIDTH;
export const WORDMARK_HEIGHT = BASELINE - ASCENDER_TOP;
/** x-height in grid units, for setting type on the wordmark's own metrics. */
export const WORDMARK_X_HEIGHT = BASELINE - X_HEIGHT_TOP;

export type WordmarkLetter = 'o1' | 't1' | 't2' | 'o2';

export const WORDMARK_LETTERS: Array<{
	key: WordmarkLetter;
	d: string;
	evenOdd: boolean;
}> = [
	{ key: 'o1', d: oGlyph(O_ONE_X), evenOdd: true },
	{ key: 't1', d: tGlyph(T_ONE_STEM), evenOdd: false },
	{ key: 't2', d: tGlyph(T_TWO_STEM), evenOdd: false },
	{ key: 'o2', d: oGlyph(O_TWO_X), evenOdd: true },
];
