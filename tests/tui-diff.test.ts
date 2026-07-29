import { describe, expect, it } from 'bun:test';
import { normalizeDiffHunks } from '../apps/tui/src/lib/diff.ts';

describe('TUI diff normalization', () => {
	it('repairs hunk counts from persisted tool artifacts', () => {
		const patch = [
			'--- a/assets/brand/README.md',
			'+++ b/assets/brand/README.md',
			'@@ -3,0 +3,3 @@',
			'-Canonical brand assets for otto and OttoRouter.',
			'-All product icons derive from these files.',
			'-Do not redraw the mark geometry.',
			'+Canonical brand assets for otto and OttoRouter.',
			'+All product icons derive from these files.',
			'+Do not redraw the mark geometry.',
		].join('\n');

		expect(normalizeDiffHunks(patch)).toContain('@@ -3,3 +3,3 @@');
	});

	it('counts context and no-newline markers correctly', () => {
		const patch = [
			'--- a/example.txt',
			'+++ b/example.txt',
			'@@ -4,1 +4,1 @@ label',
			' context',
			'-before',
			'\\ No newline at end of file',
			'+after',
			' context two',
		].join('\n');

		expect(normalizeDiffHunks(patch)).toContain('@@ -4,3 +4,3 @@ label');
	});

	it('preserves valid hunk headers', () => {
		const patch = [
			'--- a/example.txt',
			'+++ b/example.txt',
			'@@ -10,2 +10,2 @@',
			'-before',
			'+after',
			' context',
		].join('\n');

		expect(normalizeDiffHunks(patch)).toBe(patch);
	});

	it('expands bare apply-patch hunk markers', () => {
		const patch = [
			'--- a/example.txt',
			'+++ b/example.txt',
			'@@',
			'-before',
			'+after',
		].join('\n');

		expect(normalizeDiffHunks(patch)).toContain('@@ -1 +1 @@');
	});
});
