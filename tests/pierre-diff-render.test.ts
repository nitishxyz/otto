import { describe, expect, test } from 'bun:test';
import { getSingularPatch } from '@pierre/diffs';
import { preloadDiffHTML } from '@pierre/diffs/ssr';
import {
	createPierreDiffSurface,
	type PierreDiffVariant,
} from '../packages/web-sdk/src/components/diff/diffOptions';
import {
	isRenderablePierrePatch,
	normalizeToolPatch,
} from '../packages/web-sdk/src/components/diff/patchNormalize';

/**
 * Exact artifact shapes produced by Otto's patch/edit tools, captured by running
 * `buildApplyPatchTool` against a fixture file. `formatNormalizedPatch` always
 * emits the `*** Begin Patch` envelope with `*** Add|Update|Delete File:`
 * sections and `@@ -a,b +c,d @@` headers — never `---`/`+++` unified headers.
 */
const APPLY_PATCH_ARTIFACTS = {
	update:
		'*** Begin Patch\n*** Update File: f.ts\n@@ -3,2 +3,3 @@\n-l3\n-l4\n+L3\n+L4\n+L4b\n*** End Patch',
	replaceIn:
		'*** Begin Patch\n*** Update File: f.ts\n@@ -84,2 +84,3 @@\n-line84\n-line85\n+LINE84\n+LINE85\n+LINE85b\n*** End Patch',
	replaceLinesWithContext:
		'*** Begin Patch\n*** Update File: f.ts\n@@ -84,3 +84,2 @@ lines 84-86\n-line84\n-line85\n-line86\n+A\n+B\n*** End Patch',
	addFile:
		'*** Begin Patch\n*** Add File: newfile.ts\n@@ -0,0 +1,2 @@\n+alpha\n+beta\n*** End Patch',
	deleteFile:
		'*** Begin Patch\n*** Delete File: gone.ts\n@@ -1,2 +0,0 @@\n-a\n-b\n*** End Patch',
};

/**
 * Mirrors the card from the reported regression: a single-file apply_patch on
 * `compiler.ts` reporting `-84-96 +84-112 (+28, -12)`.
 */
function compilerRegressionArtifact(): string {
	const lines = [
		'*** Begin Patch',
		'*** Update File: packages/sdk/src/core/src/artifacts/compiler.ts',
		'@@ -84,13 +84,29 @@',
		' const compiled = compile(source);',
	];
	for (let i = 0; i < 12; i += 1) lines.push(`-  legacy line ${i}`);
	for (let i = 0; i < 28; i += 1) lines.push(`+  replacement line ${i}`);
	lines.push('*** End Patch');
	return lines.join('\n');
}

const stripChrome = (html: string) =>
	html
		.replace(/<style[\s\S]*?<\/style>/g, '')
		.replace(/<svg[\s\S]*?<\/svg>/g, '');

/** Visible text; Pierre splits a line across many token/word-diff spans. */
const visibleText = (html: string) => html.replace(/<[^>]*>/g, '');

/**
 * Counts rendered code rows of a type. `data-line-type` appears on both the
 * gutter and the content column, so only content rows (`data-line="N"`) count.
 */
const codeRows = (html: string, type: string) =>
	(
		html.match(
			new RegExp(`<div data-line="[^"]*"[^>]*data-line-type="${type}"`, 'g'),
		) ?? []
	).length;

async function render(patch: string, variant: PierreDiffVariant = 'inline') {
	const { options } = createPierreDiffSurface('otto-dark', { variant });
	return stripChrome(
		await preloadDiffHTML({ fileDiff: getSingularPatch(patch), options }),
	);
}

describe('apply_patch cards render real diff rows (regression)', () => {
	test('the reported compiler.ts payload yields visible additions and deletions', async () => {
		const raw = compilerRegressionArtifact();
		const files = normalizeToolPatch(raw);

		expect(files).toHaveLength(1);
		expect(files[0].path).toBe(
			'packages/sdk/src/core/src/artifacts/compiler.ts',
		);

		const html = await render(files[0].patch);
		expect(codeRows(html, 'change-deletion')).toBe(12);
		expect(codeRows(html, 'change-addition')).toBe(28);
		// The actual text must survive normalization, not just the row markers.
		const text = visibleText(html);
		expect(text).toContain('legacy line 0');
		expect(text).toContain('replacement line 27');
		expect(text).toContain('const compiled = compile(source);');
	});

	test('no hunk lines are dropped when rebuilding the patch', () => {
		const [file] = normalizeToolPatch(compilerRegressionArtifact());
		const body = file.patch.split('\n');

		expect(
			body.filter((l) => l.startsWith('-') && !l.startsWith('---')),
		).toHaveLength(12);
		expect(
			body.filter((l) => l.startsWith('+') && !l.startsWith('+++')),
		).toHaveLength(28);
	});

	for (const [name, artifact] of Object.entries(APPLY_PATCH_ARTIFACTS)) {
		test(`the ${name} artifact renders content rather than an empty shell`, async () => {
			const files = normalizeToolPatch(artifact);
			expect(files).toHaveLength(1);

			const html = await render(files[0].patch);
			const rows =
				codeRows(html, 'change-addition') + codeRows(html, 'change-deletion');
			expect(rows).toBeGreaterThan(0);
			expect(visibleText(html).trim().length).toBeGreaterThan(0);
		});
	}

	test('payloads that cannot be modelled select the fallback, not an empty diff', () => {
		// `*** Replace in:` carries no hunks, so no valid Pierre model exists.
		// The operation is still preserved so the card can render its text.
		const replaceIn =
			'*** Begin Patch\n*** Replace in: a.ts\n*** Find:\nold\n*** With:\nnew\n*** End Patch';

		const files = normalizeToolPatch(replaceIn);
		expect(files).toHaveLength(1);
		expect(files[0].renderable).toBe(false);
		expect(files[0].text).toContain('-old');
		expect(files[0].text).toContain('+new');
		expect(isRenderablePierrePatch(replaceIn)).toBe(false);
	});

	test('a patch with headers but no line content is rejected', () => {
		const empty = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n';
		expect(isRenderablePierrePatch(empty)).toBe(false);
		expect(normalizeToolPatch(empty)[0]?.renderable).toBe(false);
	});
});

/**
 * Captured by running the real `write`/`edit` tools. These use jsdiff's
 * `createTwoFilesPatch`, so they carry a `====` separator, tab-padded
 * `---`/`+++` headers and no `diff --git` line.
 */
const WRITE_EDIT_ARTIFACTS = {
	writeCreate:
		'===================================================================\n--- a/a.ts\t\n+++ b/a.ts\t\n@@ -0,0 +1,2 @@\n+const a = 1;\n+export default a;\n',
	writeOverwrite:
		'===================================================================\n--- a/a.ts\t\n+++ b/a.ts\t\n@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n export default a;\n',
	edit: '===================================================================\n--- a/a.ts\t\n+++ b/a.ts\t\n@@ -1,2 +1,2 @@\n-const a = 2;\n+const a = 3;\n export default a;\n',
};

describe('write/edit cards never render an empty diff shell', () => {
	for (const [name, artifact] of Object.entries(WRITE_EDIT_ARTIFACTS)) {
		test(`the ${name} artifact renders visible rows`, async () => {
			const files = normalizeToolPatch(artifact, 'a.ts');
			expect(files).toHaveLength(1);
			expect(files[0].path).toBe('a.ts');

			const html = await render(files[0].patch);
			const rows =
				codeRows(html, 'change-addition') + codeRows(html, 'change-deletion');
			expect(rows).toBeGreaterThan(0);
			expect(visibleText(html)).toContain('const a =');
		});
	}

	test('an overwrite keeps both the removed and added line', async () => {
		const [file] = normalizeToolPatch(
			WRITE_EDIT_ARTIFACTS.writeOverwrite,
			'a.ts',
		);
		const html = await render(file.patch);

		expect(codeRows(html, 'change-deletion')).toBe(1);
		expect(codeRows(html, 'change-addition')).toBe(1);
		expect(codeRows(html, 'context')).toBe(1);
	});
});

describe('write/edit cards render rows for whole-file payloads', () => {
	async function renderFiles(
		oldFile: { name: string; contents: string } | null,
		newFile: { name: string; contents: string },
	) {
		const { options } = createPierreDiffSurface('otto-dark', {
			variant: 'inline',
		});
		return stripChrome(await preloadDiffHTML({ oldFile, newFile, options }));
	}

	test('a created file renders every line as an addition', async () => {
		const html = await renderFiles(null, {
			name: 'src/new.ts',
			contents: 'const a = 1;\nexport default a;\n',
		});

		expect(codeRows(html, 'change-addition')).toBe(2);
		expect(codeRows(html, 'change-deletion')).toBe(0);
		expect(visibleText(html)).toContain('export default a;');
	});

	test('an overwrite renders both sides', async () => {
		const html = await renderFiles(
			{ name: 'src/new.ts', contents: 'const a = 0;\nkeep();\n' },
			{ name: 'src/new.ts', contents: 'const a = 1;\nkeep();\n' },
		);

		expect(codeRows(html, 'change-addition')).toBeGreaterThan(0);
		expect(codeRows(html, 'change-deletion')).toBeGreaterThan(0);
	});
});

describe('new/untracked git files use Pierre added-file rendering', () => {
	// Mirrors the `/v1/git/diff` payload for a status `A` / untracked file:
	// `diff` is empty and the full `content` is supplied instead.
	const untrackedResponse = {
		file: 'src/brand-new.ts',
		diff: '',
		content: 'export const brandNew = true;\nexport default brandNew;\n',
		isNewFile: true,
		isBinary: false,
		insertions: 2,
	};

	test('the payload has no patch, so a file comparison is the only valid model', () => {
		expect(untrackedResponse.diff).toBe('');
		expect(normalizeToolPatch(untrackedResponse.diff)).toEqual([]);
	});

	test('rendering it with a null old side makes every line an addition', async () => {
		const { options } = createPierreDiffSurface('otto-dark', {
			variant: 'full',
		});
		const html = stripChrome(
			await preloadDiffHTML({
				oldFile: null,
				newFile: {
					name: untrackedResponse.file,
					contents: untrackedResponse.content,
				},
				options,
			}),
		);

		expect(codeRows(html, 'change-addition')).toBe(
			untrackedResponse.insertions,
		);
		expect(codeRows(html, 'change-deletion')).toBe(0);
		expect(codeRows(html, 'context')).toBe(0);
		expect(visibleText(html)).toContain('export const brandNew = true;');
		// Bars, backgrounds and line numbers must all be active.
		expect(html).toContain('data-indicators="bars"');
		expect(html).toContain('data-background');
		expect(html).not.toContain('data-disable-line-numbers');
		expect(html).toContain('data-overflow="wrap"');
	});

	test('the source selects Pierre rather than a plain CodeMirror preview', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/git/GitDiffViewer.tsx',
		).text();

		expect(source).toContain('function NewFileGitDiffViewer');
		expect(source).toMatch(/isNewFile && diff\.content && !diff\.isBinary/);
		// The new-file branch must hand Pierre a null old side.
		const branch = source.slice(
			source.indexOf('function NewFileGitDiffViewer'),
		);
		expect(branch).toContain('oldFile={null}');
		expect(branch).toContain('PierreFileComparison');
	});
});

describe('hunk separator treatment per surface variant', () => {
	test('inline uses the most minimal separator and no expansion controls', () => {
		const { options } = createPierreDiffSurface('otto-dark', {
			variant: 'inline',
		});

		expect(options.hunkSeparators).toBe('simple');
		expect(options.expandUnchanged).toBe(false);
	});

	test('full-pane uses standard patch metadata separators', () => {
		const { options } = createPierreDiffSurface('otto-dark', {
			variant: 'full',
		});

		expect(options.hunkSeparators).toBe('metadata');
		expect(options.expandUnchanged).toBe(false);
	});

	test('neither variant uses the line-info unmodified-lines banner', () => {
		for (const variant of ['full', 'inline'] as const) {
			const { options } = createPierreDiffSurface('otto-dark', { variant });
			expect(options.hunkSeparators).not.toBe('line-info');
			expect(options.hunkSeparators).not.toBe('line-info-basic');
		}
	});

	test('inline output has no unmodified-lines banner or expand affordance', async () => {
		const [file] = normalizeToolPatch(APPLY_PATCH_ARTIFACTS.replaceIn);
		const html = await render(file.patch, 'inline');

		expect(html).not.toContain('unmodified lines');
		expect(html).not.toContain('data-expand-index');
		expect(html).not.toContain('data-separator-multi-button');
	});

	test('full-pane output shows @@ metadata instead of the banner', async () => {
		const [file] = normalizeToolPatch(APPLY_PATCH_ARTIFACTS.replaceIn);
		const html = await render(file.patch, 'full');

		expect(html).not.toContain('unmodified lines');
		expect(html).toContain('data-separator="metadata"');
	});

	test('line-info is the only variant that sets data-container-size', async () => {
		// `data-container-size` applies `container-type: inline-size`, which
		// collapsed the diff grid inside narrow inline cards.
		const [file] = normalizeToolPatch(APPLY_PATCH_ARTIFACTS.replaceIn);

		for (const variant of ['full', 'inline'] as const) {
			const html = await render(file.patch, variant);
			expect(html).not.toContain('data-container-size');
		}
	});
});
