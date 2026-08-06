import { describe, expect, test } from 'bun:test';
import { parsePatchFiles } from '@pierre/diffs';
import {
	contentHash,
	normalizeToolPatch,
} from '../packages/web-sdk/src/components/diff/patchNormalize';
import { resolvePoolSize } from '../packages/web-sdk/src/components/diff/PierreWorkerProvider';
import {
	DIFF_LINE_DIFF_TYPE,
	DIFF_TOKENIZE_MAX_LINE_LENGTH,
	createPierreDiffSurface,
} from '../packages/web-sdk/src/components/diff/diffOptions';
import { resolvePierreTheme } from '../packages/web-sdk/src/components/diff/pierreTheme';

/** Builds an N-file apply_patch envelope resembling a real refactor. */
function multiFilePatch(fileCount: number, hunksPerFile = 2): string {
	const lines = ['*** Begin Patch'];
	for (let file = 0; file < fileCount; file += 1) {
		lines.push(`*** Update File: packages/app/src/module${file}.ts`);
		for (let hunk = 0; hunk < hunksPerFile; hunk += 1) {
			const start = 10 + hunk * 40;
			lines.push(`@@ -${start},3 +${start},3 @@`);
			lines.push(`   const value${hunk} = compute(${file});`);
			lines.push(`-  return legacy(value${hunk});`);
			lines.push(`+  return modern(value${hunk});`);
		}
	}
	lines.push('*** End Patch');
	return lines.join('\n');
}

describe('payload is parsed once, not again per rendered file', () => {
	test('every renderable file carries pre-parsed Pierre metadata', () => {
		const files = normalizeToolPatch(multiFilePatch(12));

		expect(files).toHaveLength(12);
		for (const file of files) {
			expect(file.renderable).toBe(true);
			expect(file.fileDiff).toBeDefined();
			expect(file.fileDiff?.hunks.length).toBe(2);
		}
	});

	test('metadata is equivalent to what a second parse would produce', () => {
		const [file] = normalizeToolPatch(multiFilePatch(1));
		const reparsed = parsePatchFiles(file.patch)[0].files[0];

		expect(file.fileDiff?.name).toBe(reparsed.name);
		expect(file.fileDiff?.hunks.length).toBe(reparsed.hunks.length);
		expect(file.fileDiff?.additionLines?.length).toBe(
			reparsed.additionLines?.length,
		);
	});

	test('renderers consume metadata rather than reparsing patch strings', async () => {
		const inline = await Bun.file(
			'packages/web-sdk/src/components/diff/InlineDiff.tsx',
		).text();
		const git = await Bun.file(
			'packages/web-sdk/src/components/git/GitDiffViewer.tsx',
		).text();
		const session = await Bun.file(
			'packages/web-sdk/src/components/session-files/SessionFilesDiffPanel.tsx',
		).text();

		for (const source of [inline, git, session]) {
			expect(source).toContain('PierreFileDiff');
			// PatchDiff reparses the string it is given.
			expect(source).not.toContain('PierrePatchDiff');
		}
	});
});

describe('stable deterministic cache keys', () => {
	test('cache keys are stable across repeated normalization', () => {
		const patch = multiFilePatch(5);
		const first = normalizeToolPatch(patch).map((f) => f.fileDiff?.cacheKey);
		const second = normalizeToolPatch(patch).map((f) => f.fileDiff?.cacheKey);

		expect(first).toEqual(second);
		expect(
			first.every((key) => typeof key === 'string' && key.length > 0),
		).toBe(true);
	});

	test('ids are stable, unique and content-derived', () => {
		const patch = multiFilePatch(8);
		const ids = normalizeToolPatch(patch).map((f) => f.id);

		expect(new Set(ids).size).toBe(8);
		expect(normalizeToolPatch(patch).map((f) => f.id)).toEqual(ids);
	});

	test('cache keys change when the content changes', () => {
		const before = normalizeToolPatch(multiFilePatch(1));
		const after = normalizeToolPatch(
			multiFilePatch(1).replace('modern(value0)', 'renamed(value0)'),
		);

		expect(after[0].fileDiff?.cacheKey).not.toBe(before[0].fileDiff?.cacheKey);
		expect(after[0].id).not.toBe(before[0].id);
	});

	test('cache keys are compact rather than embedding the patch text', () => {
		const patch = multiFilePatch(4);
		for (const file of normalizeToolPatch(patch)) {
			const key = file.fileDiff?.cacheKey ?? '';
			expect(key.length).toBeLessThan(32);
			expect(patch).not.toContain(key);
		}
	});

	test('error-boundary keys no longer embed whole patches', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/PierreDiff.tsx',
		).text();

		// The boundary key used to interpolate the entire patch string, which
		// retained it for the lifetime of the mounted component.
		expect(source).not.toContain(['}:$', '{patch}`'].join(''));
		expect(source).toContain('contentHash');
	});

	test('contentHash is deterministic, compact and collision-free here', () => {
		const values = Array.from({ length: 500 }, (_, i) => `sample-content-${i}`);
		const hashes = values.map(contentHash);

		expect(new Set(hashes).size).toBe(values.length);
		expect(hashes.every((h) => h.length <= 7)).toBe(true);
		expect(contentHash('stable')).toBe(contentHash('stable'));
	});
});

describe('worker pool configuration', () => {
	test('pool size is derived from cores and capped for a desktop app', () => {
		expect(resolvePoolSize(1)).toBe(1);
		expect(resolvePoolSize(4)).toBe(2);
		expect(resolvePoolSize(8)).toBe(3);
		// Never the library default of 8, even on very large machines.
		expect(resolvePoolSize(64)).toBe(3);
		expect(resolvePoolSize(undefined)).toBe(2);
	});

	test('worker-managed options match the component options', () => {
		// With a pool mounted these five are owned by the manager and override
		// per-component values, so they must be initialised identically.
		const { options } = createPierreDiffSurface('otto-dark', {
			variant: 'inline',
		});

		expect(options.lineDiffType).toBe(DIFF_LINE_DIFF_TYPE);
		expect(options.tokenizeMaxLineLength).toBe(DIFF_TOKENIZE_MAX_LINE_LENGTH);
	});

	test('the provider seeds and syncs the same theme object shape', () => {
		const resolved = resolvePierreTheme('gruvbox');

		expect(resolved.theme.dark).toBe('otto-gruvbox');
		expect(resolved.theme.light).toBe('otto-gruvbox');
	});

	test('custom Otto themes resolve to serializable registrations', async () => {
		// Workers cannot run the app's lazy theme loaders; the pool resolves
		// themes on the main thread and posts the resolved registration across.
		const { resolveThemes } = await import('@pierre/diffs');
		const [registration] = await resolveThemes([
			resolvePierreTheme('tokyo-night').theme.dark,
		]);

		expect(registration.name).toBe('otto-tokyo-night');
		expect(() => structuredClone(registration)).not.toThrow();
		expect(registration.settings?.length ?? 0).toBeGreaterThan(0);
	});

	test('theme sync skips redundant updates for the same palette', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/PierreWorkerProvider.tsx',
		).text();

		expect(source).toContain('appliedThemeRef');
		expect(source).toContain('if (appliedThemeRef.current === themeId) return');
	});

	test('the pool is created once and not recreated per render', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/PierreWorkerProvider.tsx',
		).text();

		// poolOptions only depends on the factory, never on the theme.
		expect(source).toContain('}, [workerFactory]);');
		// highlighterOptions is seeded once.
		expect(source).toContain('\t\t[],\n\t);');
	});

	test('apps mount the provider above the router so it is never unmounted', async () => {
		const web = await Bun.file('apps/web/src/App.tsx').text();
		const desktop = await Bun.file('apps/desktop/src/main.tsx').text();

		for (const source of [web, desktop]) {
			expect(source).toContain('PierreDiffProvider');
			expect(source).toContain('createPierreWorker');
		}
	});

	test('both apps use the documented Vite worker import', async () => {
		for (const path of [
			'apps/web/src/lib/pierre-worker.ts',
			'apps/desktop/src/lib/pierre-worker.ts',
		]) {
			const source = await Bun.file(path).text();
			expect(source).toContain("'@pierre/diffs/worker/worker.js?worker&url'");
			expect(source).toContain("{ type: 'module' }");
		}
	});

	test('both Vite configs emit ES module workers', async () => {
		for (const path of [
			'apps/web/vite.config.ts',
			'apps/desktop/vite.config.ts',
		]) {
			const source = await Bun.file(path).text();
			expect(source).toMatch(/worker:\s*\{[\s\S]*?format:\s*'es'/);
		}
	});
});

describe('large multi-file payloads stay tractable', () => {
	test('a 20-file / 40-hunk payload normalizes into distinct models', () => {
		const files = normalizeToolPatch(multiFilePatch(20, 2));

		expect(files).toHaveLength(20);
		expect(new Set(files.map((f) => f.fileDiff?.cacheKey)).size).toBe(20);
		expect(files.reduce((total, f) => total + f.hunks.length, 0)).toBe(40);
	});

	test('normalization of 20 files is a single pass over the payload', () => {
		const patch = multiFilePatch(20, 2);
		const started = performance.now();
		const files = normalizeToolPatch(patch);
		const elapsed = performance.now() - started;

		expect(files).toHaveLength(20);
		// Guards against reintroducing a per-file reparse of the whole payload.
		expect(elapsed).toBeLessThan(1_000);
	});
});

describe('multi-file cards virtualize instead of mounting one surface per file', () => {
	test('the multi-file branch renders exactly one CodeView, not N surfaces', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/InlineDiff.tsx',
		).text();

		// A single CodeView element is the entire multi-file body.
		// (`\s` avoids matching the `useMemo<CodeViewItem[]>` type argument.)
		expect((source.match(/<CodeView\s/g) ?? []).length).toBe(1);
		// It owns the bounded scroll root, so there is no nested scroller.
		expect(source).toContain('className={INLINE_DIFF_VIEWPORT_CLASS}');
		// The per-file map is only reachable through the non-virtualized branch.
		expect(source).toContain('const canVirtualize =');
		expect(source).toContain('files.length > 1');
	});

	test('CodeView items come from the normalized model with stable ids', () => {
		const files = normalizeToolPatch(multiFilePatch(20));
		const items = files.map((file) => ({
			id: file.id,
			type: 'diff' as const,
			fileDiff: file.fileDiff,
		}));

		expect(items).toHaveLength(20);
		expect(new Set(items.map((i) => i.id)).size).toBe(20);
		expect(items.every((i) => i.fileDiff?.cacheKey)).toBe(true);
		// Source order is preserved for the rendered item list.
		expect(items[0].fileDiff?.name).toContain('module0.ts');
		expect(items[19].fileDiff?.name).toContain('module19.ts');
	});

	test('CodeView keeps the file header slot so custom headers can render', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/InlineDiff.tsx',
		).text();
		const block = source.slice(source.indexOf('function VirtualizedPatchDiff'));

		// Pierre skips the header entirely when disableFileHeader is true, which
		// would also drop renderCustomHeader.
		expect(block).toContain('hideFileHeader: false');
		expect(block).toContain('renderCustomHeader');
	});

	test('single-file cards stay on the non-virtualized FileDiff path', () => {
		const files = normalizeToolPatch(
			'*** Begin Patch\n*** Update File: solo.ts\n@@ -1,2 +1,2 @@\n-a\n+b\n*** End Patch',
		);

		expect(files).toHaveLength(1);
		// `canVirtualize` requires more than one file.
		expect(files.length > 1).toBe(false);
	});

	test('a payload with a malformed sibling keeps the non-virtualized layout', () => {
		const files = normalizeToolPatch(
			[
				'*** Begin Patch',
				'*** Update File: good.ts',
				'@@ -1,1 +1,1 @@',
				'-a',
				'+b',
				'*** Replace in: custom.ts',
				'*** Find:',
				'x',
				'*** With:',
				'y',
				'*** End Patch',
			].join('\n'),
		);

		expect(files).toHaveLength(2);
		expect(files.every((f) => f.renderable)).toBe(false);
	});
});

describe('surfaces survive remounting against a reused DOM node', () => {
	// Pierre's File/FileDiff React hooks create their instance in a ref callback
	// and `cleanUp()` empties the <pre> inside the shadow root without removing
	// it. The next hydrate() finds that leftover <pre> and, because
	// `shouldRenderCode()` is `pre == null && hasContent`, adopts the empty
	// markup instead of rendering — leaving the surface permanently blank/plain.
	// StrictMode re-attaches refs against the same node on the first commit, so
	// every diff in both apps hit this. Verified in real Chrome.
	test('ref-callback surfaces reset the shadow root on detach', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/PierreDiff.tsx',
		).text();

		expect(source).toContain('function useShadowResetHost');
		expect(source).toContain("querySelectorAll('diffs-container')");
		expect(source).toContain('shadowRoot?.replaceChildren()');
	});

	test('every ref-callback surface uses the reset host', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/PierreDiff.tsx',
		).text();

		// FileDiff, PatchDiff and MultiFileDiff all go through the instance hooks.
		expect((source.match(/=\s*useShadowResetHost\(\)/g) ?? []).length).toBe(3);
		expect((source.match(/ref=\{shadowResetHost\}/g) ?? []).length).toBe(3);
	});

	test('the reset host only clears on detach, never on attach', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/PierreDiff.tsx',
		).text();
		const hook = source.slice(source.indexOf('function useShadowResetHost'));

		// Attaching must record the node and return before any clearing, so a
		// freshly rendered surface is never wiped.
		expect(hook).toContain('if (node !== null) {');
		expect(hook).toContain('hostRef.current = node;');
		expect(hook.indexOf('hostRef.current = node;')).toBeLessThan(
			hook.indexOf('replaceChildren()'),
		);
	});

	test('the wrapper does not disturb layout', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/PierreDiff.tsx',
		).text();

		// `display: contents` keeps the wrapper out of the box tree so the
		// bounded viewport/CodeView geometry is unchanged.
		expect((source.match(/className="contents"/g) ?? []).length).toBe(3);
	});
});

describe('worker pool readiness and failure handling', () => {
	test('the pool is created once for the app, never per card', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/PierreWorkerProvider.tsx',
		).text();

		// poolOptions depends only on the factory, so a theme change never
		// recreates the pool.
		expect(source).toContain('}, [workerFactory]);');
		expect(source).toContain('[],\n\t);');
	});

	test('theme sync dedupes repeated updates for the same palette', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/PierreWorkerProvider.tsx',
		).text();

		expect(source).toContain('appliedThemeRef');
		expect(source).toContain('if (appliedThemeRef.current === themeId) return');
	});

	test('omitting a worker factory keeps main-thread highlighting', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/PierreWorkerProvider.tsx',
		).text();

		// No pool options -> children render without a pool rather than blocking.
		expect(source).toContain('if (!poolOptions) return <>{children}</>;');
	});

	test('the initial pool theme is registered before the pool resolves it', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/diff/PierreWorkerProvider.tsx',
		).text();
		const opts = source.slice(source.indexOf('highlighterOptions'));

		// resolvePierreTheme() runs ensurePierreTheme(), which must happen before
		// WorkerPoolContextProvider constructs the manager and resolves themes.
		expect(opts).toContain('resolvePierreTheme(');
	});
});
