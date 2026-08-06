import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getSingularPatch, parsePatchFiles } from '@pierre/diffs';
import { preloadDiffHTML } from '@pierre/diffs/ssr';
import { ApplyPatchRenderer } from '../packages/web-sdk/src/components/messages/renderers/ApplyPatchRenderer';
import { formatHunkLabel } from '../packages/web-sdk/src/components/diff/InlineDiff';
import { createPierreDiffSurface } from '../packages/web-sdk/src/components/diff/diffOptions';
import {
	normalizeToolPatch,
	summarizePatchFiles,
	type NormalizedPatchFile,
} from '../packages/web-sdk/src/components/diff/patchNormalize';

/**
 * Captured by executing the real `buildApplyPatchTool` against a fixture repo.
 * `formatNormalizedPatch` emits one `*** Add|Update|Delete File:` section per
 * operation, in source order, each with its own `@@` hunks.
 */
const MIXED_ARTIFACT = [
	'*** Begin Patch',
	'*** Update File: a.ts',
	'@@ -1,2 +1,2 @@',
	'-l1',
	'+L1',
	' l2',
	'@@ -8,2 +8,3 @@',
	' l8',
	'-l9',
	'+L9',
	'+L9b',
	'*** Add File: new.ts',
	'@@ -0,0 +1,2 @@',
	'+alpha',
	'+beta',
	'*** Delete File: c.ts',
	'@@ -1,10 +0,0 @@',
	'-l1',
	'-l2',
	'-l3',
	'-l4',
	'-l5',
	'-l6',
	'-l7',
	'-l8',
	'-l9',
	'-l10',
	'*** Update File: b.ts',
	'@@ -3,2 +3,2 @@',
	'-l3',
	'+B3',
	' l4',
	'*** End Patch',
].join('\n');

const TWO_UPDATES = [
	'*** Begin Patch',
	'*** Update File: src/one.ts',
	'@@ -1,2 +1,2 @@',
	'-one',
	'+ONE',
	' keep',
	'*** Update File: src/two.ts',
	'@@ -5,2 +5,2 @@',
	'-two',
	'+TWO',
	' keep',
	'*** End Patch',
].join('\n');

const stripChrome = (html: string) =>
	html
		.replace(/<style[\s\S]*?<\/style>/g, '')
		.replace(/<svg[\s\S]*?<\/svg>/g, '');
const visibleText = (html: string) => html.replace(/<[^>]*>/g, '');
const codeRows = (html: string, type: string) =>
	(
		html.match(
			new RegExp(`<div data-line="[^"]*"[^>]*data-line-type="${type}"`, 'g'),
		) ?? []
	).length;

async function renderFile(file: NormalizedPatchFile) {
	const { options } = createPierreDiffSurface('otto-dark', {
		variant: 'inline',
	});
	return stripChrome(
		await preloadDiffHTML({ fileDiff: getSingularPatch(file.patch), options }),
	);
}

function renderCard(contentJson: Record<string, unknown>) {
	const client = new QueryClient();
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<ApplyPatchRenderer
				// biome-ignore lint/suspicious/noExplicitAny: test payload fixture
				contentJson={contentJson as any}
				toolDurationMs={12}
				isExpanded
				onToggle={() => {}}
			/>
		</QueryClientProvider>,
	);
}

describe('one apply_patch call parses into ordered per-file operations', () => {
	test('two updated files in one envelope both survive', () => {
		const files = normalizeToolPatch(TWO_UPDATES);

		expect(files).toHaveLength(2);
		expect(files.map((f) => f.path)).toEqual(['src/one.ts', 'src/two.ts']);
		expect(files.every((f) => f.renderable)).toBe(true);
		expect(new Set(files.map((f) => f.id)).size).toBe(2);
	});

	test('a file with multiple hunks keeps every hunk under that file', () => {
		const files = normalizeToolPatch(MIXED_ARTIFACT);
		const a = files.find((f) => f.path === 'a.ts');

		expect(a).toBeDefined();
		expect(a?.hunks).toHaveLength(2);
		expect((a?.patch.match(/^@@/gm) ?? []).length).toBe(2);
		expect(a?.hunks[0].oldStart).toBe(1);
		expect(a?.hunks[1].oldStart).toBe(8);
		// Both hunks' content must be present in the single per-file patch.
		expect(a?.patch).toContain('-l1');
		expect(a?.patch).toContain('+L9b');
	});

	test('mixed add + update + delete in one call all parse, in source order', () => {
		const files = normalizeToolPatch(MIXED_ARTIFACT);

		expect(files.map((f) => f.path)).toEqual([
			'a.ts',
			'new.ts',
			'c.ts',
			'b.ts',
		]);
		expect(files.map((f) => f.kind)).toEqual([
			'update',
			'add',
			'delete',
			'update',
		]);
		expect(files.every((f) => f.renderable)).toBe(true);
	});

	test('aggregate totals sum every file and operation', () => {
		const totals = summarizePatchFiles(normalizeToolPatch(MIXED_ARTIFACT));

		// a.ts +3/-2, new.ts +2/-0, c.ts +0/-10, b.ts +1/-1. Verified to match
		// the summary the real apply_patch tool reports for this exact call.
		expect(totals.files).toBe(4);
		expect(totals.additions).toBe(6);
		expect(totals.deletions).toBe(13);
	});

	test('each per-file patch is singular and Pierre-parseable', () => {
		for (const file of normalizeToolPatch(MIXED_ARTIFACT)) {
			const parsed = parsePatchFiles(file.patch);
			expect(parsed).toHaveLength(1);
			expect(parsed[0].files).toHaveLength(1);
		}
	});
});

describe('standard multi-file git and unified patches', () => {
	const GIT_MULTI = [
		'diff --git a/x.ts b/x.ts',
		'--- a/x.ts',
		'+++ b/x.ts',
		'@@ -1,2 +1,2 @@',
		'-x',
		'+X',
		' keep',
		'diff --git a/y.ts b/y.ts',
		'new file mode 100644',
		'--- /dev/null',
		'+++ b/y.ts',
		'@@ -0,0 +1,1 @@',
		'+fresh',
		'diff --git a/z.ts b/z.ts',
		'deleted file mode 100644',
		'--- a/z.ts',
		'+++ /dev/null',
		'@@ -1,1 +0,0 @@',
		'-gone',
	].join('\n');

	test('a multi-file git patch splits into one entry per file', () => {
		const files = normalizeToolPatch(GIT_MULTI);

		expect(files.map((f) => f.path)).toEqual(['x.ts', 'y.ts', 'z.ts']);
		expect(files.map((f) => f.kind)).toEqual(['update', 'add', 'delete']);
		expect(files.every((f) => f.renderable)).toBe(true);
	});

	test('git multi-file stats aggregate correctly', () => {
		const totals = summarizePatchFiles(normalizeToolPatch(GIT_MULTI));
		expect(totals.files).toBe(3);
		expect(totals.additions).toBe(2);
		expect(totals.deletions).toBe(2);
	});

	test('a multi-file jsdiff/unified payload splits per file', () => {
		const unified = [
			'===================================================================',
			'--- a/p.ts\t',
			'+++ b/p.ts\t',
			'@@ -1,1 +1,1 @@',
			'-p',
			'+P',
			'===================================================================',
			'--- a/q.ts\t',
			'+++ b/q.ts\t',
			'@@ -1,1 +1,1 @@',
			'-q',
			'+Q',
		].join('\n');
		const files = normalizeToolPatch(unified);

		expect(files.map((f) => f.path)).toEqual(['p.ts', 'q.ts']);
		expect(files.every((f) => f.renderable)).toBe(true);
	});

	test('a git rename without hunks is kept but not sent to Pierre', () => {
		const rename = [
			'diff --git a/old.ts b/new.ts',
			'similarity index 100%',
			'rename from old.ts',
			'rename to new.ts',
		].join('\n');
		const files = normalizeToolPatch(rename);

		expect(files).toHaveLength(1);
		expect(files[0].kind).toBe('rename');
		expect(files[0].path).toBe('new.ts');
		expect(files[0].previousPath).toBe('old.ts');
		expect(files[0].renderable).toBe(false);
	});
});

describe('a malformed operation falls back without affecting its siblings', () => {
	const MIXED_VALIDITY = [
		'*** Begin Patch',
		'*** Update File: good.ts',
		'@@ -1,1 +1,1 @@',
		'-a',
		'+b',
		'*** Replace in: custom.ts',
		'*** Find:',
		'needle',
		'*** With:',
		'replacement',
		'*** Update File: alsogood.ts',
		'@@ -2,1 +2,1 @@',
		'-c',
		'+d',
		'*** End Patch',
	].join('\n');

	test('every operation is preserved, valid ones stay renderable', () => {
		const files = normalizeToolPatch(MIXED_VALIDITY);

		expect(files.map((f) => f.path)).toEqual([
			'good.ts',
			'custom.ts',
			'alsogood.ts',
		]);
		expect(files.map((f) => f.renderable)).toEqual([true, false, true]);
	});

	test('the fallback keeps visible additions and deletions', () => {
		const custom = normalizeToolPatch(MIXED_VALIDITY).find(
			(f) => f.path === 'custom.ts',
		);

		expect(custom?.text).toContain('-needle');
		expect(custom?.text).toContain('+replacement');
		expect(custom?.additions).toBe(1);
		expect(custom?.deletions).toBe(1);
	});

	test('valid siblings still render real Pierre rows', async () => {
		const files = normalizeToolPatch(MIXED_VALIDITY).filter(
			(f) => f.renderable,
		);
		expect(files).toHaveLength(2);

		for (const file of files) {
			const html = await renderFile(file);
			expect(codeRows(html, 'change-addition')).toBeGreaterThan(0);
			expect(codeRows(html, 'change-deletion')).toBeGreaterThan(0);
		}
	});
});

describe('no file operation renders an empty surface', () => {
	test('every renderable file in a mixed call produces code rows', async () => {
		const files = normalizeToolPatch(MIXED_ARTIFACT);

		for (const file of files) {
			expect(file.renderable).toBe(true);
			const html = await renderFile(file);
			const rows =
				codeRows(html, 'change-addition') + codeRows(html, 'change-deletion');
			expect(rows).toBeGreaterThan(0);
			expect(visibleText(html).trim().length).toBeGreaterThan(0);
		}
	});

	test('a non-renderable operation always carries fallback text', () => {
		const files = normalizeToolPatch(
			'*** Begin Patch\n*** Replace in: only.ts\n*** Find:\nx\n*** With:\ny\n*** End Patch',
		);

		expect(files).toHaveLength(1);
		expect(files[0].renderable).toBe(false);
		expect(files[0].text.trim().length).toBeGreaterThan(0);
	});

	test('an operation is never dropped from the model', () => {
		// Regression: filtering unrenderable files left the card showing a path
		// and hunk chips with no diff rows beneath them.
		const files = normalizeToolPatch(MIXED_VALIDITY_PATCH);
		expect(files).toHaveLength(3);
		for (const file of files) {
			expect(file.renderable || file.text.length > 0).toBe(true);
		}
	});
});

const MIXED_VALIDITY_PATCH = [
	'*** Begin Patch',
	'*** Update File: good.ts',
	'@@ -1,1 +1,1 @@',
	'-a',
	'+b',
	'*** Replace in: custom.ts',
	'*** Find:',
	'needle',
	'*** With:',
	'replacement',
	'*** Update File: alsogood.ts',
	'@@ -2,1 +2,1 @@',
	'-c',
	'+d',
	'*** End Patch',
].join('\n');

describe('the apply-patch card renders all files in one card', () => {
	// Multi-file bodies render through Pierre's imperative `CodeView`, so the
	// per-file headers exist only after mount. Real-browser proof that all
	// files, headers and rows render came from a real headless Chrome run.
	test('every file becomes one ordered item for the card body', () => {
		const files = normalizeToolPatch(MIXED_ARTIFACT);

		expect(files.map((f) => f.path)).toEqual([
			'a.ts',
			'new.ts',
			'c.ts',
			'b.ts',
		]);
		// Each file appears exactly once, so no path row can be duplicated.
		expect(new Set(files.map((f) => f.path)).size).toBe(4);
		expect(files.every((f) => f.renderable)).toBe(true);
	});

	test('a single-file card still renders its path row in markup', () => {
		const markup = renderCard({
			artifact: {
				patch:
					'*** Begin Patch\n*** Update File: only.ts\n@@ -1,2 +1,2 @@\n-a\n+b\n*** End Patch',
			},
			result: { changes: [] },
		});

		expect(markup).toContain('only.ts');
		expect(markup.split('>only.ts<').length - 1).toBeLessThanOrEqual(1);
	});

	test('the top-level summary shows the first path plus a file count', () => {
		const markup = renderCard({
			artifact: {
				patch: MIXED_ARTIFACT,
				summary: { files: 4, additions: 5, deletions: 13 },
			},
			result: { changes: [] },
		});

		expect(markup).toContain('a.ts');
		expect(markup).toContain('+3 files');
	});

	test('a single-file call shows no extra file count', () => {
		const markup = renderCard({
			artifact: {
				patch:
					'*** Begin Patch\n*** Update File: solo.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n*** End Patch',
				summary: { files: 1, additions: 1, deletions: 1 },
			},
			result: { changes: [] },
		});

		expect(markup).toContain('solo.ts');
		expect(markup).not.toMatch(/\+\d+ files?/);
	});

	test('hunk chip labels are produced for each file, multi-hunk included', () => {
		const files = normalizeToolPatch(MIXED_ARTIFACT);
		const a = files.find((f) => f.path === 'a.ts');
		const labels = (a?.hunks ?? []).map(formatHunkLabel);

		expect(labels).toEqual(['-1-2 +1-2 (+1, -1)', '-8-9 +8-10 (+2, -1)']);
		// Every file contributes at least one chip.
		expect(files.every((f) => f.hunks.length > 0)).toBe(true);
	});

	test('add and delete operations are labelled', () => {
		const kinds = normalizeToolPatch(MIXED_ARTIFACT).map((f) => f.kind);

		expect(kinds).toContain('add');
		expect(kinds).toContain('delete');
	});

	test('a single-file card renders its hunk chip and mounts one surface', () => {
		const markup = renderCard({
			artifact: {
				patch:
					'*** Begin Patch\n*** Add File: fresh.ts\n@@ -0,0 +1,2 @@\n+one\n+two\n*** End Patch',
			},
			result: { changes: [] },
		});

		// The top-level row owns the filename, so the per-file path row (and its
		// kind badge) is suppressed; the hunk chip still renders.
		expect(markup).toContain('fresh.ts');
		expect(markup).toContain('-0 +1-2 (+2)');
		expect((markup.match(/<diffs-container/g) ?? []).length).toBe(1);
	});

	test('totals fall back to the parsed model when no summary is present', () => {
		const markup = renderCard({
			artifact: { patch: MIXED_ARTIFACT },
			result: { changes: [] },
		});

		expect(markup).toContain('+3 files');
	});

	test('a malformed sibling still renders its fallback text in the card', () => {
		const markup = renderCard({
			artifact: { patch: MIXED_VALIDITY_PATCH },
			result: { changes: [] },
		});

		expect(markup).toContain('custom.ts');
		expect(markup).toContain('needle');
		expect(markup).toContain('replacement');
	});
});

describe('regression: chips without code rows', () => {
	test('the card no longer renders a standalone chips-only list', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/messages/renderers/ApplyPatchRenderer.tsx',
		).text();

		// The old layout mapped `changes` into its own path+chips block that was
		// independent of the diff, so a dropped file showed chips with no rows.
		expect(source).not.toContain('changes.map(');
		expect(source).toContain('InlinePatchDiff');
	});

	test('path row, chips and diff come from one per-file model', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/InlineDiff.tsx',
		).text();

		expect(source).toContain('function PatchFileSection');
		// The section renders the path row, the chips and the diff together.
		const section = source.slice(source.indexOf('function PatchFileSection'));
		expect(section).toContain('FileSectionHeader');
		expect(section).toContain('PierreFileDiff');
		expect(section).toContain('PlainPatchFallback');
		// The header block owns the path row and the hunk chips.
		const header = source.slice(source.indexOf('function FileSectionHeader'));
		expect(header).toContain('FilePathRow');
		expect(header).toContain('HunkChips');
	});

	test('multi-file payloads are never handed to a singular PatchDiff', () => {
		// `getSingularPatch` throws on multi-file input; each per-file patch must
		// pass it individually.
		for (const file of normalizeToolPatch(MIXED_ARTIFACT)) {
			expect(() => getSingularPatch(file.patch)).not.toThrow();
		}
		expect(() => getSingularPatch(MIXED_ARTIFACT)).toThrow();
	});
});
