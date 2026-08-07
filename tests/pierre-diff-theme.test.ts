import { describe, expect, test } from 'bun:test';
import { getSingularPatch } from '@pierre/diffs';
import { preloadDiffHTML } from '@pierre/diffs/ssr';
import { getTheme, themeIds } from '@ottocode/themes';
import {
	getPierreThemeName,
	ottoThemeToShikiTheme,
	resolvePierreTheme,
} from '../packages/web-sdk/src/components/diff/pierreTheme';
import { createPierreDiffSurface } from '../packages/web-sdk/src/components/diff/diffOptions';

const PATCH =
	'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n const label = "hi";\n-export default label;\n+export default label.trim();\n';

describe('otto theme to shiki adapter', () => {
	test('produces a valid registration for every selectable theme', () => {
		for (const id of themeIds) {
			const otto = getTheme(id);
			const shiki = ottoThemeToShikiTheme(otto);

			// Pierre rejects a resolved theme whose name differs from the request.
			expect(shiki.name).toBe(getPierreThemeName(id));
			expect(shiki.type).toBe(otto.mode);
			expect(shiki.fg).toBe(otto.colors.fg);
			expect(shiki.bg).toBe(otto.colors.bg);
			expect(shiki.settings[0].settings.foreground).toBe(otto.colors.fg);
			expect(shiki.settings.length).toBeGreaterThan(10);
			for (const setting of shiki.settings.slice(1)) {
				expect(setting.scope?.length ?? 0).toBeGreaterThan(0);
				expect(setting.settings.foreground).toBeTruthy();
			}
		}
	});

	test('maps Otto syntax tokens onto the emitted TextMate scopes', () => {
		const shiki = ottoThemeToShikiTheme(getTheme('otto-dark'));
		const syntax = getTheme('otto-dark').syntax;
		const scopeColor = (scope: string) =>
			shiki.settings.find((s) => s.scope?.includes(scope))?.settings.foreground;

		expect(scopeColor('keyword')).toBe(syntax.keyword);
		expect(scopeColor('string')).toBe(syntax.string);
		expect(scopeColor('comment')).toBe(syntax.comment);
		expect(scopeColor('constant.numeric')).toBe(syntax.number);
		expect(scopeColor('entity.name.function')).toBe(syntax.function);
	});

	test('exposes git decoration colors Pierre reads for diff accents', () => {
		for (const id of themeIds) {
			const otto = getTheme(id);
			const colors = ottoThemeToShikiTheme(otto).colors;

			expect(colors['gitDecoration.addedResourceForeground']).toBe(
				otto.colors.diffAddedSign,
			);
			expect(colors['gitDecoration.deletedResourceForeground']).toBe(
				otto.colors.diffRemovedSign,
			);
		}
	});

	test('gives each theme a distinct identity and matching themeType', () => {
		const names = new Set<string>();
		for (const id of themeIds) {
			const resolved = resolvePierreTheme(id);
			expect(resolved.theme.dark).toBe(resolved.theme.light);
			expect(resolved.themeType).toBe(getTheme(id).mode);
			names.add(resolved.theme.dark);
		}
		expect(names.size).toBe(themeIds.length);
	});

	test('uses the previous Otto diff accents with theme-aware line numbers', () => {
		const otto = getTheme('rose-pine');
		const { cssVariables } = resolvePierreTheme('rose-pine');

		expect(cssVariables['--diffs-addition-color-override']).toBe(
			'rgb(16 185 129)',
		);
		expect(cssVariables['--diffs-deletion-color-override']).toBe(
			'rgb(239 68 68)',
		);
		expect(cssVariables['--diffs-fg-number-override']).toBe(
			otto.colors.diffLineNumberFg,
		);
		// Pierre mixes the accent into the changed-line background itself, so
		// overriding that background directly would double-mute it.
		expect(cssVariables['--diffs-bg-addition-override']).toBeUndefined();
	});
});

describe('shared pierre diff surface options', () => {
	test('applies the required display defaults', () => {
		const { options } = createPierreDiffSurface('otto-dark');

		expect(options.diffIndicators).toBe('bars');
		expect(options.disableBackground).toBe(false);
		expect(options.disableLineNumbers).toBe(false);
		expect(options.overflow).toBe('wrap');
		expect(options.lineDiffType).toBe('word-alt');
		expect(options.diffStyle).toBe('unified');
		expect(options.unsafeCSS).toContain('rgb(16 185 129 / 0.12)');
		expect(options.unsafeCSS).toContain('rgb(239 68 68 / 0.11)');
		expect(options.unsafeCSS).toContain(
			'[data-column-number][data-line-type="change-addition"]::before',
		);
		expect(options.unsafeCSS).toContain(
			'[data-column-number][data-line-type="change-deletion"]::before',
		);
		expect(options.unsafeCSS).toContain('width: 4px');
	});

	test('hides the Pierre header by default and can show it on request', () => {
		expect(createPierreDiffSurface('otto-dark').options.disableFileHeader).toBe(
			true,
		);
		expect(
			createPierreDiffSurface('otto-dark', { hideFileHeader: false }).options
				.disableFileHeader,
		).toBe(false);
	});

	test('carries the design-system typography variables', () => {
		const style = createPierreDiffSurface('otto-light').style as Record<
			string,
			string
		>;

		expect(style['--diffs-font-family']).toContain('--otto-font-family');
		expect(style['--diffs-font-size']).toBeTruthy();
		expect(style['--diffs-tab-size']).toBeTruthy();
		expect(style['--diffs-min-number-column-width']).toBeUndefined();
	});

	test('matches full diff surfaces to the active viewer tab background', () => {
		const fullStyle = createPierreDiffSurface('otto-dark').style as Record<
			string,
			string
		>;
		const inlineStyle = createPierreDiffSurface('otto-dark', {
			variant: 'inline',
		}).style as Record<string, string>;

		expect(fullStyle['--diffs-dark-bg']).toBe('hsl(var(--sidebar-background))');
		expect(fullStyle['--diffs-light-bg']).toBe(
			'hsl(var(--sidebar-background))',
		);
		expect(inlineStyle['--diffs-dark-bg']).toBeUndefined();
		expect(inlineStyle['--diffs-light-bg']).toBeUndefined();
	});

	test('changes syntax and neutral chrome while preserving diff semantics', () => {
		const dark = createPierreDiffSurface('otto-dark');
		const gruvbox = createPierreDiffSurface('gruvbox');
		const darkStyle = dark.style as Record<string, string>;
		const gruvboxStyle = gruvbox.style as Record<string, string>;

		expect(dark.options.theme.dark).not.toBe(gruvbox.options.theme.dark);
		expect(darkStyle['--diffs-addition-color-override']).toBe(
			gruvboxStyle['--diffs-addition-color-override'],
		);
		expect(darkStyle['--diffs-fg-number-override']).not.toBe(
			gruvboxStyle['--diffs-fg-number-override'],
		);
	});
});

describe('rendered diffs follow the active otto theme', () => {
	async function renderWithTheme(themeId: 'otto-dark' | 'monokai') {
		const { options } = createPierreDiffSurface(themeId);
		return preloadDiffHTML({
			fileDiff: getSingularPatch(PATCH),
			options,
		});
	}

	test('emits the theme syntax colors rather than a fixed pierre palette', async () => {
		const html = await renderWithTheme('otto-dark');
		const syntax = getTheme('otto-dark').syntax;

		expect(html.toLowerCase()).toContain(syntax.string.toLowerCase());
		expect(html.toLowerCase()).toContain(
			getTheme('otto-dark').colors.bg.toLowerCase(),
		);
	});

	test('recolors when a different otto theme is selected', async () => {
		const [dark, monokai] = await Promise.all([
			renderWithTheme('otto-dark'),
			renderWithTheme('monokai'),
		]);

		expect(dark).not.toBe(monokai);
		expect(monokai.toLowerCase()).toContain(
			getTheme('monokai').syntax.string.toLowerCase(),
		);
		expect(monokai.toLowerCase()).not.toContain(
			getTheme('otto-dark').colors.bg.toLowerCase(),
		);
	});
});
