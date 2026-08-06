import { normalizeThemeId, type ThemeId } from '@ottocode/themes';
import type { ThemeTypes } from '@pierre/diffs';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { useTheme } from '../../hooks/useTheme';
import { resolvePierreTheme } from './pierreTheme';

/**
 * Hunk separator treatments we allow.
 *
 * `line-info`/`line-info-basic` are deliberately excluded: they render a large
 * rounded "N unmodified lines" expansion control that does not belong in Otto's
 * UI, and they are the only variants that mark the code element with
 * `data-container-size` (`container-type: inline-size`), which collapses the
 * diff grid inside narrow inline flex containers.
 */
type OttoHunkSeparators = 'metadata' | 'simple';

/** Options accepted by every `@pierre/diffs` React surface we render. */
export interface PierreDiffOptions {
	theme: { dark: string; light: string };
	themeType: ThemeTypes;
	diffStyle: 'unified' | 'split';
	diffIndicators: 'bars' | 'classic' | 'none';
	disableBackground: boolean;
	disableLineNumbers: boolean;
	disableFileHeader: boolean;
	overflow: 'scroll' | 'wrap';
	lineDiffType: 'word-alt';
	hunkSeparators: OttoHunkSeparators;
	/** Expansion controls are never offered; the payloads are partial diffs. */
	expandUnchanged: false;
	tokenizeMaxLineLength: number;
	unsafeCSS: string;
}

/**
 * `full` is the Git/session pane: standard `@@` patch metadata separators,
 * matching the hunk headers Otto's previous viewer displayed.
 * `inline` is a chat/tool card: the most minimal built-in separator, with no
 * unmodified-line banner or expand affordance.
 */
export type PierreDiffVariant = 'full' | 'inline';

const SEPARATORS: Record<PierreDiffVariant, OttoHunkSeparators> = {
	full: 'metadata',
	inline: 'simple',
};

const MONO_FONT_STACK =
	'var(--otto-font-family, "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

/**
 * Preserve Otto's previous diff treatment: quiet emerald/red fills, neutral
 * line numbers, and stronger bars. Pierre's default dark-mode mix is notably
 * heavier, so these direct, stable data-attribute selectors restore the old
 * visual hierarchy without replacing Pierre's syntax or layout rendering.
 */
export const OTTO_DIFF_COLORS_CSS = `
[data-background] [data-line][data-line-type="change-addition"] {
	--diffs-computed-diff-line-bg: rgb(16 185 129 / 0.12);
}
[data-background] [data-line][data-line-type="change-deletion"] {
	--diffs-computed-diff-line-bg: rgb(239 68 68 / 0.11);
}
[data-background] [data-column-number][data-line-type="change-addition"],
[data-background] [data-column-number][data-line-type="change-deletion"] {
	--diffs-computed-diff-line-bg: var(--diffs-bg);
	color: var(--diffs-fg-number);
}
[data-line-type="change-addition"] [data-diff-span] {
	background-color: rgb(16 185 129 / 0.18);
}
[data-line-type="change-deletion"] [data-diff-span] {
	background-color: rgb(239 68 68 / 0.16);
}
`;

/**
 * Typography Pierre inherits through its shadow root. Kept at module scope so
 * the object identity is stable across renders.
 */
const VARIANT_STYLE: Record<PierreDiffVariant, Record<string, string>> = {
	full: {
		'--diffs-font-family': MONO_FONT_STACK,
		'--diffs-header-font-family': MONO_FONT_STACK,
		'--diffs-font-size': '13px',
		'--diffs-line-height': '1.3125rem',
		'--diffs-tab-size': '2',
		'--diffs-min-number-column-width': '2.25rem',
	},
	inline: {
		'--diffs-font-family': MONO_FONT_STACK,
		'--diffs-header-font-family': MONO_FONT_STACK,
		'--diffs-font-size': '12px',
		'--diffs-line-height': '1.25rem',
		'--diffs-tab-size': '2',
		'--diffs-min-number-column-width': '1.75rem',
	},
};

/**
 * Keeps minified/generated single-line files from stalling the surface.
 * Exported because the worker pool owns this option once mounted and must be
 * initialised with the same value the components would otherwise use.
 */
export const DIFF_TOKENIZE_MAX_LINE_LENGTH = 1_000;

/** Inline word-level highlighting; also worker-managed once a pool exists. */
export const DIFF_LINE_DIFF_TYPE = 'word-alt' as const;

const TOKENIZE_MAX_LINE_LENGTH = DIFF_TOKENIZE_MAX_LINE_LENGTH;

export interface PierreDiffSurface {
	options: PierreDiffOptions;
	style: CSSProperties;
	/** Changes whenever the palette changes, for remount/cache-key purposes. */
	themeId: ThemeId;
}

export interface PierreDiffSurfaceInput {
	variant?: PierreDiffVariant;
	/**
	 * Hide Pierre's own file header when the surrounding panel already renders
	 * the filename and status chrome.
	 */
	hideFileHeader?: boolean;
	/** Extra inherited CSS custom properties or layout styles. */
	style?: CSSProperties;
}

export function createPierreDiffSurface(
	themeId: ThemeId,
	input: PierreDiffSurfaceInput = {},
): PierreDiffSurface {
	const resolved = resolvePierreTheme(themeId);
	const variant = input.variant ?? 'full';
	return {
		themeId,
		options: {
			theme: resolved.theme,
			themeType: resolved.themeType,
			diffStyle: 'unified',
			diffIndicators: 'bars',
			disableBackground: false,
			disableLineNumbers: false,
			disableFileHeader: input.hideFileHeader ?? true,
			overflow: 'wrap',
			lineDiffType: DIFF_LINE_DIFF_TYPE,
			hunkSeparators: SEPARATORS[variant],
			expandUnchanged: false,
			tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
			unsafeCSS: OTTO_DIFF_COLORS_CSS,
		},
		style: {
			...VARIANT_STYLE[variant],
			...resolved.cssVariables,
			...input.style,
		} as CSSProperties,
	};
}

/**
 * Resolves the shared Pierre options/styles for the currently active Otto
 * theme. Re-renders (and therefore recolors) whenever the theme changes.
 */
export function usePierreDiffSurface(
	input: PierreDiffSurfaceInput = {},
): PierreDiffSurface {
	const { theme } = useTheme();
	const variant = input.variant;
	const hideFileHeader = input.hideFileHeader;
	const style = input.style;
	const themeId = useMemo(() => {
		if (theme) return theme;
		if (typeof document !== 'undefined') {
			return normalizeThemeId(document.documentElement.dataset.theme);
		}
		return normalizeThemeId(undefined);
	}, [theme]);

	return useMemo(
		() => createPierreDiffSurface(themeId, { variant, hideFileHeader, style }),
		[themeId, variant, hideFileHeader, style],
	);
}
