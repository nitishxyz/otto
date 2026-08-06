import { describe, expect, test } from 'bun:test';
import { parsePatchFiles } from '@pierre/diffs';
import {
	LARGE_DIFF_LIMITED_PREVIEW_CHARS,
	getLimitedPreview,
	isImageFile,
} from '../packages/web-sdk/src/components/git/gitDiffPatch';
import { normalizeGitPatch } from '../packages/web-sdk/src/components/diff/patchNormalize';

const HUNK = '@@ -1,2 +1,2 @@\n-old\n+new\n context\n';

describe('normalizeGitPatch', () => {
	test('keeps a standard single-file git patch intact', () => {
		const patch = `diff --git a/src/app.ts b/src/app.ts\nindex 111..222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n${HUNK}`;

		expect(normalizeGitPatch(patch, 'src/app.ts')).toBe(patch);
	});

	test('narrows multi-file payloads to the selected file', () => {
		const first = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${HUNK}`;
		const second = `diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n${HUNK}`;
		const result = normalizeGitPatch(`${first}${second}`, 'src/b.ts');

		expect(result).toBe(second);
		expect(result).not.toContain('src/a.ts');
	});

	test('falls back to the first section when no file matches', () => {
		const first = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${HUNK}`;
		const second = `diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n${HUNK}`;

		expect(normalizeGitPatch(`${first}${second}`, 'src/missing.ts')).toBe(
			first,
		);
	});

	test('adds a git header to bare unified diffs', () => {
		const patch = `--- a/src/app.ts\n+++ b/src/app.ts\n${HUNK}`;

		expect(normalizeGitPatch(patch, 'src/app.ts')).toBe(
			`diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n${HUNK}`,
		);
	});

	test('synthesizes full headers for hunk-only payloads', () => {
		expect(normalizeGitPatch(HUNK, './src/app.ts')).toBe(
			`diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n${HUNK}`,
		);
	});

	test('normalizes CRLF and guarantees a trailing newline', () => {
		const patch =
			'diff --git a/a.ts b/a.ts\r\n--- a/a.ts\r\n+++ b/a.ts\r\n@@ -1 +1 @@\r\n-a\r\n+b';

		expect(normalizeGitPatch(patch, 'a.ts')).toBe(
			'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n',
		);
	});

	test('falls back for pure renames, which have no lines to render', () => {
		// Rendering these through Pierre would produce an empty diff shell.
		const patch =
			'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n';

		expect(normalizeGitPatch(patch, 'new.ts')).toBeNull();
	});

	test('returns null for empty or unrecognizable payloads', () => {
		expect(normalizeGitPatch('', 'a.ts')).toBeNull();
		expect(normalizeGitPatch('   \n\n', 'a.ts')).toBeNull();
		expect(normalizeGitPatch('not a patch at all', 'a.ts')).toBeNull();
	});
});

describe('normalizeGitPatch output stays parseable by @pierre/diffs', () => {
	// `PatchDiff` throws unless the payload resolves to exactly one patch with
	// exactly one file diff, so every normalized shape has to satisfy that.
	const cases: Array<[string, string, string]> = [
		[
			'git patch',
			`diff --git a/src/app.ts b/src/app.ts\nindex 111..222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n${HUNK}`,
			'src/app.ts',
		],
		[
			'multi-file payload',
			`diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${HUNK}diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n${HUNK}`,
			'src/b.ts',
		],
		['bare unified diff', `--- a/x.ts\n+++ b/x.ts\n${HUNK}`, 'x.ts'],
		['hunk-only payload', HUNK, 'src/app.ts'],
	];

	for (const [label, raw, file] of cases) {
		test(`parses a singular file diff from a ${label}`, () => {
			const patch = normalizeGitPatch(raw, file);
			expect(patch).not.toBeNull();

			const parsed = parsePatchFiles(patch as string);
			expect(parsed).toHaveLength(1);
			expect(parsed[0].files).toHaveLength(1);
		});
	}
});

describe('git diff preview helpers', () => {
	test('truncates oversized diffs and explains why', () => {
		const content = `${'a'.repeat(LARGE_DIFF_LIMITED_PREVIEW_CHARS)}tail`;
		const preview = getLimitedPreview(content);

		expect(preview.content).not.toBe(content);
		expect(preview.content.endsWith('tail')).toBe(true);
		expect(preview.notice).toContain('Large diff/file');
	});

	test('leaves small diffs untouched', () => {
		expect(getLimitedPreview('small')).toEqual({ content: 'small' });
	});

	test('detects image paths case-insensitively', () => {
		expect(isImageFile('assets/Logo.PNG')).toBe(true);
		expect(isImageFile('src/app.ts')).toBe(false);
		expect(isImageFile('Makefile')).toBe(false);
	});
});
