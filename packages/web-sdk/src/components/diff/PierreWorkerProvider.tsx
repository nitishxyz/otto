import { normalizeThemeId, type ThemeId } from '@ottocode/themes';
import {
	WorkerPoolContextProvider,
	useWorkerPool,
	type WorkerInitializationRenderOptions,
} from '@pierre/diffs/react';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { useTheme } from '../../hooks/useTheme';
import {
	DIFF_LINE_DIFF_TYPE,
	DIFF_TOKENIZE_MAX_LINE_LENGTH,
} from './diffOptions';
import { resolvePierreTheme } from './pierreTheme';

/**
 * Creates a Pierre highlighting worker. Apps own this because the URL has to be
 * resolved by their own bundler; Vite uses
 * `import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'`.
 */
export type PierreWorkerFactory = () => Worker;

/**
 * Shiki tokenization is the expensive part of rendering a diff and runs on the
 * main thread unless a worker pool is provided. Two workers cover the common
 * case (a handful of files in one tool card) without paying for a full Shiki
 * grammar/theme runtime per core; the cap keeps memory bounded on big
 * machines and the floor keeps low-core devices working.
 */
export function resolvePoolSize(hardwareConcurrency?: number): number {
	const cores =
		typeof hardwareConcurrency === 'number' && hardwareConcurrency > 0
			? hardwareConcurrency
			: 4;
	// Leave the main thread plus a core for the rest of the app.
	return Math.max(1, Math.min(3, Math.floor(cores / 2)));
}

/**
 * The AST LRU is shared by every mounted diff, so collapsing and reopening a
 * tool card is served from cache instead of re-tokenized.
 */
const AST_CACHE_SIZE = 200;

interface PierreDiffProviderProps {
	children: ReactNode;
	/** Defer config reads until the host has configured its API client. */
	configEnabled?: boolean;
	/**
	 * Omit to keep main-thread highlighting (used by tests/SSR and by any
	 * consumer whose bundler cannot emit a worker chunk).
	 */
	workerFactory?: PierreWorkerFactory;
}

/**
 * Keeps the worker pool's render options in step with the active Otto theme.
 *
 * With a pool mounted, `theme`, `lineDiffType`, `tokenizeMaxLineLength`,
 * `useTokenTransformer` and `maxLineDiffLength` are owned by the pool manager
 * and override the per-component options, so they have to be mirrored here or
 * diffs would silently fall back to Pierre's default palette.
 */
function WorkerThemeSync({ configEnabled }: { configEnabled: boolean }) {
	const pool = useWorkerPool();
	const { theme } = useTheme({ enabled: configEnabled });
	const appliedThemeRef = useRef<string | null>(null);

	const themeId: ThemeId = useMemo(() => {
		if (theme) return theme;
		if (typeof document !== 'undefined') {
			return normalizeThemeId(document.documentElement.dataset.theme);
		}
		return normalizeThemeId(undefined);
	}, [theme]);

	useEffect(() => {
		if (!pool) return;
		// The pool dedupes equal options internally, but skipping here avoids the
		// async resolve/postMessage round trip on every unrelated rerender.
		if (appliedThemeRef.current === themeId) return;
		appliedThemeRef.current = themeId;

		void pool.setRenderOptions({
			theme: resolvePierreTheme(themeId).theme,
			lineDiffType: DIFF_LINE_DIFF_TYPE,
			tokenizeMaxLineLength: DIFF_TOKENIZE_MAX_LINE_LENGTH,
		});
	}, [pool, themeId]);

	return null;
}

/**
 * Mounts the shared Pierre worker pool once, at the app root, so every diff
 * surface (inline tool cards and the full Git/session panes) offloads Shiki
 * highlighting and shares one AST cache.
 *
 * The pool is a module-level singleton inside `@pierre/diffs`; keeping this
 * provider mounted for the app's lifetime means collapsing a card never tears
 * the workers down. If worker start-up fails, `WorkerPoolManager` marks itself
 * as failed and the renderers fall back to main-thread highlighting on their
 * own, so a diff never ends up stuck as plain text.
 */
export function PierreDiffProvider({
	children,
	configEnabled = true,
	workerFactory,
}: PierreDiffProviderProps) {
	const { theme } = useTheme({ enabled: configEnabled });

	// Resolved once: the pool is created on first render and must not be
	// recreated when the theme changes (WorkerThemeSync handles updates).
	const initialThemeRef = useRef<ThemeId | null>(null);
	if (initialThemeRef.current === null) {
		initialThemeRef.current =
			theme ??
			(typeof document !== 'undefined'
				? normalizeThemeId(document.documentElement.dataset.theme)
				: normalizeThemeId(undefined));
	}

	const poolOptions = useMemo(() => {
		if (!workerFactory) return null;
		return {
			workerFactory,
			poolSize: resolvePoolSize(
				typeof navigator !== 'undefined'
					? navigator.hardwareConcurrency
					: undefined,
			),
			totalASTLRUCacheSize: AST_CACHE_SIZE,
		};
	}, [workerFactory]);

	const highlighterOptions = useMemo<WorkerInitializationRenderOptions>(
		() => ({
			// Registers the custom Otto Shiki theme before the pool resolves it.
			theme: resolvePierreTheme(
				initialThemeRef.current ?? normalizeThemeId(undefined),
			).theme,
			lineDiffType: DIFF_LINE_DIFF_TYPE,
			tokenizeMaxLineLength: DIFF_TOKENIZE_MAX_LINE_LENGTH,
		}),
		[],
	);

	if (!poolOptions) return <>{children}</>;

	return (
		<WorkerPoolContextProvider
			poolOptions={poolOptions}
			highlighterOptions={highlighterOptions}
		>
			<WorkerThemeSync configEnabled={configEnabled} />
			{children}
		</WorkerPoolContextProvider>
	);
}
