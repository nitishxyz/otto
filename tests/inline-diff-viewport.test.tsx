import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	INLINE_DIFF_VIEWPORT_CLASS,
	InlineFileWriteDiff,
	InlinePatchDiff,
} from '../packages/web-sdk/src/components/diff/InlineDiff';
import { normalizeToolPatch } from '../packages/web-sdk/src/components/diff/patchNormalize';
import { ApplyPatchRenderer } from '../packages/web-sdk/src/components/messages/renderers/ApplyPatchRenderer';
import type { ContentJson } from '../packages/web-sdk/src/components/messages/renderers/types';

const MULTI_FILE_PATCH = [
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
	'@@ -1,2 +0,0 @@',
	'-l1',
	'-l2',
	'*** End Patch',
].join('\n');

function render(node: React.ReactElement) {
	const client = new QueryClient();
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>{node}</QueryClientProvider>,
	);
}

/** Counts elements carrying the vertical-scroll viewport class. */
function countViewports(markup: string): number {
	return (markup.match(/overflow-y-auto/g) ?? []).length;
}

describe('inline diff viewport bounds the tool card diff body', () => {
	test('the shared viewport class defines a bounded scrollable box', () => {
		// Bounding box.
		expect(INLINE_DIFF_VIEWPORT_CLASS).toContain('border');
		expect(INLINE_DIFF_VIEWPORT_CLASS).toContain('border-border');
		expect(INLINE_DIFF_VIEWPORT_CLASS).toContain('rounded-lg');
		expect(INLINE_DIFF_VIEWPORT_CLASS).toContain('bg-card/60');
		// Vertical scrolling only; wrapping still handles horizontal overflow.
		expect(INLINE_DIFF_VIEWPORT_CLASS).toContain('overflow-y-auto');
		expect(INLINE_DIFF_VIEWPORT_CLASS).not.toContain('overflow-x-auto');
	});

	test('the max height is responsive and uses existing design tokens', () => {
		// `max-h-80` matches ToolContentBox for narrow panes; `sm:max-h-[32rem]`
		// is an existing roomier token for wider viewports.
		expect(INLINE_DIFF_VIEWPORT_CLASS).toContain('max-h-80');
		expect(INLINE_DIFF_VIEWPORT_CLASS).toContain('sm:max-h-[32rem]');
		// No viewport-relative height that could swallow the desktop screen.
		expect(INLINE_DIFF_VIEWPORT_CLASS).not.toMatch(/max-h-\[\d+vh\]/);
	});

	test('scroll chaining is left at the default so the chat stays usable', () => {
		expect(INLINE_DIFF_VIEWPORT_CLASS).not.toContain('overscroll');
	});

	// NOTE: multi-file payloads now render through Pierre's `CodeView`, which is
	// imperative and produces no SSR markup. The rendered properties (visible
	// rows, one scrollbar, virtualization, scroll reveal, theme recolour) are
	// verified against real headless Chrome (visible rows, one scrollbar, only
	// 4/20 files mounted, scroll reveal, theme recolour) via a temporary Vite +
	// CDP harness. These tests assert the structural contract only.

	test('a multi-file patch mounts exactly one CodeView scroll root', () => {
		const markup = render(<InlinePatchDiff patch={MULTI_FILE_PATCH} />);

		// CodeView receives the bounded viewport class as its own className, so
		// there is exactly one scroll root and never a nested one.
		expect(countViewports(markup)).toBe(1);
		expect((markup.match(/rounded-lg/g) ?? []).length).toBe(1);
	});

	test('the multi-file path applies the bounded viewport to CodeView itself', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/InlineDiff.tsx',
		).text();
		const virtualized = source.slice(
			source.indexOf('function VirtualizedPatchDiff'),
		);

		expect(virtualized).toContain('<CodeView');
		expect(virtualized).toContain('className={INLINE_DIFF_VIEWPORT_CLASS}');
		// Custom headers keep the path row and hunk chips per file.
		expect(virtualized).toContain('renderCustomHeader');
		expect(virtualized).toContain('FileSectionHeader');
	});

	test('every file becomes one ordered CodeView item with a stable id', () => {
		const files = normalizeToolPatch(MULTI_FILE_PATCH);

		expect(files.map((f) => f.path)).toEqual(['a.ts', 'new.ts', 'c.ts']);
		expect(files.every((f) => f.renderable && f.fileDiff)).toBe(true);
		expect(new Set(files.map((f) => f.id)).size).toBe(files.length);
	});

	test('a single-file patch also uses the bounded viewport', () => {
		const solo = [
			'*** Begin Patch',
			'*** Update File: solo.ts',
			'@@ -1,1 +1,1 @@',
			'-a',
			'+b',
			'*** End Patch',
		].join('\n');
		const markup = render(<InlinePatchDiff patch={solo} />);

		expect(countViewports(markup)).toBe(1);
		// Confirms the real diff path, not the unparseable-payload fallback.
		expect(markup).toContain('solo.ts');
		expect(markup).toContain('-1 +1');
	});

	test('an unparseable payload still renders inside the viewport', () => {
		const markup = render(<InlinePatchDiff patch="not a patch at all" />);

		expect(countViewports(markup)).toBe(1);
		expect(markup).toContain('not a patch at all');
	});

	test('write/create diffs use the same bounded viewport', () => {
		const markup = render(
			<InlineFileWriteDiff
				path="src/new.ts"
				content={'const a = 1;\nexport default a;\n'}
				previousContent={null}
			/>,
		);

		expect(countViewports(markup)).toBe(1);
		expect(markup).toContain('src/new.ts');
	});

	test('an empty write still renders a bounded fallback', () => {
		const markup = render(
			<InlineFileWriteDiff path="empty.ts" content="" previousContent={null} />,
		);
		expect(countViewports(markup)).toBe(1);
	});
});

describe('the tool card header stays outside the scroll viewport', () => {
	const CARD_PAYLOAD: ContentJson = {
		artifact: {
			patch: MULTI_FILE_PATCH,
			summary: { files: 3, additions: 5, deletions: 5 },
		},
		result: { changes: [] },
	};

	const cardMarkup = (isExpanded: boolean) =>
		render(
			<ApplyPatchRenderer
				contentJson={CARD_PAYLOAD}
				toolDurationMs={12}
				isExpanded={isExpanded}
				onToggle={() => {}}
			/>,
		);

	test('the summary row precedes the viewport in the markup', () => {
		const markup = cardMarkup(true);
		const summaryIndex = markup.indexOf('apply patch');
		const viewportIndex = markup.indexOf('overflow-y-auto');

		expect(summaryIndex).toBeGreaterThan(-1);
		expect(viewportIndex).toBeGreaterThan(-1);
		expect(summaryIndex).toBeLessThan(viewportIndex);
	});

	test('the whole expanded card still has one scrollbar', () => {
		expect(countViewports(cardMarkup(true))).toBe(1);
	});

	test('a collapsed card mounts no diff body at all', () => {
		const markup = cardMarkup(false);

		expect(countViewports(markup)).toBe(0);
		expect(markup).not.toContain('new.ts');
	});
});

describe('full-pane git/session diff scrolling is unchanged', () => {
	test('the git viewer does not use the inline viewport class', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/git/GitDiffViewer.tsx',
		).text();

		expect(source).not.toContain('INLINE_DIFF_VIEWPORT_CLASS');
		expect(source).not.toContain('sm:max-h-[32rem]');
		// It still fills its pane rather than capping height.
		expect(source).toContain('FULL_HEIGHT_SURFACE_STYLE');
	});

	test('the session files panel keeps its own full-height scrolling', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/session-files/SessionFilesDiffPanel.tsx',
		).text();

		expect(source).not.toContain('INLINE_DIFF_VIEWPORT_CLASS');
		expect(source).toContain('FULL_HEIGHT_SURFACE_STYLE');
	});

	test('only the inline variant caps its height', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/InlineDiff.tsx',
		).text();

		// The Pierre surfaces themselves must not scroll; the viewport does.
		expect(source).toContain('INLINE_SURFACE_STYLE: CSSProperties = {}');
	});
});
