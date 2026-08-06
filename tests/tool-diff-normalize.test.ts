import { describe, expect, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';
import { parsePatchFiles } from '@pierre/diffs';
import { preloadDiffHTML } from '@pierre/diffs/ssr';
import { normalizeToolPatch } from '../packages/web-sdk/src/components/diff/patchNormalize';
import { createPierreDiffSurface } from '../packages/web-sdk/src/components/diff/diffOptions';

/** Mirrors `buildWriteArtifact` in the write/edit/multiedit/copy_into tools. */
function writeArtifactPatch(
	relPath: string,
	oldText: string,
	newText: string,
): string {
	return createTwoFilesPatch(
		`a/${relPath}`,
		`b/${relPath}`,
		oldText,
		newText,
		'',
		'',
		{ context: 3 },
	);
}

function expectSingularPierrePatch(patch: string) {
	const parsed = parsePatchFiles(patch);
	expect(parsed).toHaveLength(1);
	expect(parsed[0].files).toHaveLength(1);
	return parsed[0].files[0];
}

describe('normalizeToolPatch - write/edit artifacts (jsdiff)', () => {
	test('converts an edit artifact into a singular git patch', () => {
		const patch = writeArtifactPatch(
			'src/app.ts',
			'const a = 1;\nexport default a;\n',
			'const a = 1;\nexport default a + 1;\n',
		);
		const files = normalizeToolPatch(patch);

		expect(files).toHaveLength(1);
		expect(files[0].path).toBe('src/app.ts');
		expect(files[0].kind).toBe('update');
		expect(
			files[0].patch.startsWith('diff --git a/src/app.ts b/src/app.ts\n'),
		).toBe(true);

		const parsed = expectSingularPierrePatch(files[0].patch);
		expect(parsed.name).toBe('src/app.ts');
		expect(parsed.type).toBe('change');
	});

	test('drops the jsdiff separator line and header tab padding', () => {
		const patch = writeArtifactPatch('a.ts', 'x\n', 'y\n');
		const [file] = normalizeToolPatch(patch);

		expect(file.patch).not.toContain('====');
		expect(file.patch).not.toContain('\t');
	});

	test('preserves the actual added and removed lines', () => {
		const patch = writeArtifactPatch('a.ts', 'keep\ndrop\n', 'keep\nadd\n');
		const [file] = normalizeToolPatch(patch);

		expect(file.patch).toContain('-drop');
		expect(file.patch).toContain('+add');
		expect(file.patch).toContain(' keep');
	});
});

describe('normalizeToolPatch - enveloped apply_patch artifacts', () => {
	test('splits a multi-file envelope into singular patches', () => {
		const patch = [
			'*** Begin Patch',
			'*** Update File: src/a.ts',
			'@@ -1,2 +1,2 @@',
			' keep',
			'-old',
			'+new',
			'*** Add File: src/b.ts',
			'@@ -0,0 +1,2 @@',
			'+first',
			'+second',
			'*** End Patch',
		].join('\n');

		const files = normalizeToolPatch(patch);
		expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
		expect(files.map((f) => f.kind)).toEqual(['update', 'add']);

		for (const file of files) expectSingularPierrePatch(file.patch);
	});

	test('marks added files with a /dev/null old side', () => {
		const patch = [
			'*** Begin Patch',
			'*** Add File: new.ts',
			'@@ -0,0 +1,1 @@',
			'+hello',
			'*** End Patch',
		].join('\n');

		const [file] = normalizeToolPatch(patch);
		expect(file.patch).toContain('--- /dev/null');
		expect(file.patch).toContain('new file mode');
		expect(expectSingularPierrePatch(file.patch).type).toBe('new');
	});

	test('marks deleted files with a /dev/null new side', () => {
		const patch = [
			'*** Begin Patch',
			'*** Delete File: gone.ts',
			'@@ -1,1 +0,0 @@',
			'-bye',
			'*** End Patch',
		].join('\n');

		const [file] = normalizeToolPatch(patch);
		expect(file.patch).toContain('+++ /dev/null');
		expect(expectSingularPierrePatch(file.patch).type).toBe('deleted');
	});

	test('gives bare `@@` markers explicit line ranges', () => {
		const patch = [
			'*** Begin Patch',
			'*** Add File: bare.ts',
			'@@',
			'+one',
			'+two',
			'*** End Patch',
		].join('\n');

		const [file] = normalizeToolPatch(patch);
		expect(file.patch).toContain('@@ -0,0 +1,2 @@');
		expectSingularPierrePatch(file.patch);
	});

	test('recomputes stale hunk counts from the actual lines', () => {
		const patch = [
			'*** Begin Patch',
			'*** Update File: stale.ts',
			'@@ -5,99 +5,99 @@',
			' ctx',
			'-a',
			'+b',
			'*** End Patch',
		].join('\n');

		const [file] = normalizeToolPatch(patch);
		expect(file.patch).toContain('@@ -5,2 +5,2 @@');
	});

	test('rejects non-diff envelope directives instead of guessing', () => {
		const replaceIn = [
			'*** Begin Patch',
			'*** Replace in: src/a.ts',
			'*** Find:',
			'old text',
			'*** With:',
			'new text',
			'*** End Patch',
		].join('\n');
		const lineDirective = [
			'*** Begin Patch',
			'*** Replace Lines in: src/a.ts',
			'*** Lines: 20-30',
			'*** With:',
			'replacement',
			'*** End Patch',
		].join('\n');

		// The operations are preserved so each can render its own text fallback,
		// but neither is handed to Pierre.
		const replaceInFiles = normalizeToolPatch(replaceIn);
		expect(replaceInFiles).toHaveLength(1);
		expect(replaceInFiles[0].renderable).toBe(false);
		expect(replaceInFiles[0].path).toBe('src/a.ts');

		const lineFiles = normalizeToolPatch(lineDirective);
		expect(lineFiles).toHaveLength(1);
		expect(lineFiles[0].renderable).toBe(false);
		expect(lineFiles[0].path).toBe('src/a.ts');
	});

	test('keeps parseable files from an envelope with one bad section', () => {
		const patch = [
			'*** Begin Patch',
			'*** Update File: good.ts',
			'@@ -1,1 +1,1 @@',
			'-a',
			'+b',
			'*** Update File: bad.ts',
			'*** Find:',
			'nope',
			'*** End Patch',
		].join('\n');

		// Both operations survive; only the parseable one goes to Pierre.
		const files = normalizeToolPatch(patch);
		expect(files.map((f) => f.path)).toEqual(['good.ts', 'bad.ts']);
		expect(files.map((f) => f.renderable)).toEqual([true, false]);
	});
});

describe('normalizeToolPatch - git payloads and fallbacks', () => {
	test('splits raw git diff output per file', () => {
		const patch =
			'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n' +
			'diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-c\n+d\n';

		const files = normalizeToolPatch(patch);
		expect(files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
		for (const file of files) expectSingularPierrePatch(file.patch);
	});

	test('detects new and deleted files in git payloads', () => {
		const added =
			'diff --git a/n.ts b/n.ts\nnew file mode 100644\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1 @@\n+a\n';
		const removed =
			'diff --git a/d.ts b/d.ts\ndeleted file mode 100644\n--- a/d.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n';

		expect(normalizeToolPatch(added)[0].kind).toBe('add');
		expect(normalizeToolPatch(removed)[0].kind).toBe('delete');
	});

	test('uses the fallback path for hunk-only payloads', () => {
		const files = normalizeToolPatch('@@ -1 +1 @@\n-a\n+b', 'src/only.ts');
		expect(files[0].path).toBe('src/only.ts');
		expectSingularPierrePatch(files[0].patch);
	});

	test('returns nothing for payloads that are not diffs', () => {
		expect(normalizeToolPatch('')).toEqual([]);
		expect(normalizeToolPatch('   \n  ')).toEqual([]);
		expect(normalizeToolPatch('just some prose')).toEqual([]);
	});
});

describe('whole-file writes render as direct file comparisons', () => {
	const { options } = createPierreDiffSurface('otto-dark');
	const CONTENT = 'const a = 1;\nexport default a;\n';
	const stripStyles = (html: string) =>
		html.replace(/<style[\s\S]*?<\/style>/g, '');
	const count = (html: string, needle: string) => html.split(needle).length - 1;

	test('a created file has no old side and is all additions', async () => {
		const html = stripStyles(
			await preloadDiffHTML({
				oldFile: null,
				newFile: { name: 'src/new.ts', contents: CONTENT },
				options,
			}),
		);

		expect(count(html, 'change-addition')).toBeGreaterThan(0);
		expect(count(html, 'change-deletion')).toBe(0);
		expect(count(html, 'line-type="context')).toBe(0);
	});

	test('an existing file with content produces a real diff', async () => {
		const html = stripStyles(
			await preloadDiffHTML({
				oldFile: {
					name: 'src/new.ts',
					contents: 'const a = 0;\nexport default a;\n',
				},
				newFile: { name: 'src/new.ts', contents: CONTENT },
				options,
			}),
		);

		expect(count(html, 'change-addition')).toBeGreaterThan(0);
		expect(count(html, 'change-deletion')).toBeGreaterThan(0);
		expect(count(html, 'line-type="context')).toBeGreaterThan(0);
	});

	test('an intentionally empty old file still renders as a comparison', async () => {
		// Pierre classifies both a missing and an empty old side as `new`, but the
		// empty side must still be accepted as a valid comparison input.
		const html = stripStyles(
			await preloadDiffHTML({
				oldFile: { name: 'src/new.ts', contents: '' },
				newFile: { name: 'src/new.ts', contents: CONTENT },
				options: { ...options, disableFileHeader: false },
			}),
		);

		expect(html).toContain('src/new.ts');
		expect(count(html, 'change-addition')).toBeGreaterThan(0);
	});

	test('language is inferred from the filename, not the payload', async () => {
		const html = stripStyles(
			await preloadDiffHTML({
				oldFile: null,
				newFile: { name: 'src/new.ts', contents: CONTENT },
				options,
			}),
		);

		// `const` must be tokenized as a keyword using the active Otto palette.
		expect(html).toContain('--diffs-token-dark:#C678DD');
	});
});
