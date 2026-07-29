/**
 * Shared NeoPop token maps.
 *
 * Colour values resolve through the `--np-*` CSS variables declared in
 * `src/index.css`, so every tone is theme-aware in both light and dark mode.
 */

export type NeoTone =
	| 'surface'
	| 'bg'
	| 'card'
	| 'ink'
	| 'blue'
	| 'lime'
	| 'yellow'
	| 'coral';

export type NeoElevation = 'none' | 'sm' | 'md' | 'lg';

/** The four brand colours, i.e. every tone that is not a neutral surface. */
export type NeoAccent = 'blue' | 'lime' | 'yellow' | 'coral';

/**
 * Colours the edge and hard shadow in the accent itself, leaving the fill
 * neutral. Use on cards that should read as outlined-and-dropped in a colour.
 */
export const ACCENT_TINT: Record<NeoAccent, string> = {
	blue: 'np-tint-blue',
	lime: 'np-tint-lime',
	yellow: 'np-tint-yellow',
	coral: 'np-tint-coral',
};

/**
 * Edge and shadow for a surface already filled with the accent: both take the
 * deep shade of that colour, so the extrusion looks like the fill in shadow.
 * Neutral tones keep the default ink edge.
 */
export const TONE_EDGE: Record<NeoTone, string> = {
	surface: '',
	bg: '',
	card: '',
	ink: '',
	blue: 'np-solid-blue',
	lime: 'np-solid-lime',
	yellow: 'np-solid-yellow',
	coral: 'np-solid-coral',
};

/** Background + foreground pair for each tone. */
export const TONE_SURFACE: Record<NeoTone, string> = {
	surface: 'bg-otto-surface text-otto-text',
	bg: 'bg-otto-bg text-otto-text',
	card: 'bg-otto-card text-otto-text',
	ink: 'bg-otto-text text-otto-bg',
	blue: 'bg-np-blue text-np-blue-on',
	lime: 'bg-np-lime text-np-lime-on',
	yellow: 'bg-np-yellow text-np-yellow-on',
	coral: 'bg-np-coral text-np-coral-on',
};

/**
 * Hover edge colour per tone, consumed by `.np-press:hover` in `index.css`.
 * Matching the tone's fill makes a hovered button look like it grows instead
 * of gaining a grey outline.
 */
export const TONE_EDGE_HOVER: Record<NeoTone, string> = {
	surface: '[--np-edge-hover:var(--otto-surface)]',
	bg: '[--np-edge-hover:var(--otto-bg)]',
	card: '[--np-edge-hover:var(--otto-card)]',
	ink: '[--np-edge-hover:var(--otto-text)]',
	blue: '[--np-edge-hover:var(--np-blue)]',
	lime: '[--np-edge-hover:var(--np-lime)]',
	yellow: '[--np-edge-hover:var(--np-yellow)]',
	coral: '[--np-edge-hover:var(--np-coral)]',
};

/** Foreground-only accent colour, for text and icons on neutral surfaces. */
export const TONE_TEXT: Record<NeoTone, string> = {
	surface: 'text-otto-text',
	bg: 'text-otto-text',
	card: 'text-otto-text',
	ink: 'text-otto-text',
	blue: 'text-np-blue',
	lime: 'text-np-lime',
	yellow: 'text-np-yellow',
	coral: 'text-np-coral',
};

export const ELEVATION: Record<NeoElevation, string> = {
	none: '',
	sm: 'np-shadow-sm',
	md: 'np-shadow-md',
	lg: 'np-shadow-lg',
};

/** Near-square corners keep the boxy silhouette while avoiding hard pixels. */
export const NEO_RADIUS = 'rounded-[3px]';
