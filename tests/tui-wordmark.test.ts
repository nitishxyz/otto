import { describe, expect, test } from 'bun:test';
import {
	OTTO_TUI_FULL_MIN_WIDTH,
	OTTO_TUI_GLYPHS,
	OTTO_TUI_WORDMARK_HEIGHT,
	OTTO_TUI_WORDMARK_MARKERS,
	OTTO_TUI_WORDMARK_WIDTH,
	renderOttoWordmarkPlain,
	resolveOttoWordmarkVariant,
} from '../apps/tui/src/brand/wordmark.ts';

describe('TUI Otto wordmark', () => {
	test('uses fixed-width four-row glyphs and supported marker cells', () => {
		for (const glyph of OTTO_TUI_GLYPHS) {
			expect(glyph.lines).toHaveLength(OTTO_TUI_WORDMARK_HEIGHT);
			const width = glyph.lines[0].length;
			for (const line of glyph.lines) {
				expect(line.length).toBe(width);
				expect(line).toMatch(
					new RegExp(`^[ █▀▄${OTTO_TUI_WORDMARK_MARKERS}]+$`),
				);
			}
		}
	});

	test('renders the expected compact block silhouette', () => {
		const lines = renderOttoWordmarkPlain();
		expect(lines).toEqual([
			'      █   █       ',
			'█▀▀█ ▀█▀ ▀█▀ █▀▀█ ',
			'█▄▄█  █▄  █▄ █▄▄█ ',
			'▀▀▀▀  ▀▀  ▀▀ ▀▀▀▀ ',
		]);
		for (const line of lines) expect(line.length).toBe(OTTO_TUI_WORDMARK_WIDTH);
	});

	test('falls back to the one-line mark in narrow terminals', () => {
		expect(
			resolveOttoWordmarkVariant(OTTO_TUI_FULL_MIN_WIDTH - 1, 'auto'),
		).toBe('compact');
		expect(resolveOttoWordmarkVariant(OTTO_TUI_FULL_MIN_WIDTH, 'auto')).toBe(
			'full',
		);
		expect(resolveOttoWordmarkVariant(1, 'full')).toBe('full');
		expect(resolveOttoWordmarkVariant(999, 'compact')).toBe('compact');
	});
});
