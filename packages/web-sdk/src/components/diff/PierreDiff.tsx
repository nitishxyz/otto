import type { FileDiffMetadata } from '@pierre/diffs';
import { FileDiff, MultiFileDiff, PatchDiff } from '@pierre/diffs/react';
import { Component, type ReactNode, useCallback, useMemo, useRef } from 'react';
import {
	usePierreDiffSurface,
	type PierreDiffSurfaceInput,
} from './diffOptions';
import { contentHash } from './patchNormalize';

/**
 * Wraps a Pierre surface that renders through the `File`/`FileDiff` React
 * instance hooks, making it safe to mount twice against the same DOM node.
 *
 * Those hooks create their instance in a ref callback and `cleanUp()` empties
 * the `<pre>` inside the shadow root without removing it. The next `hydrate()`
 * walks the shadow root, finds that leftover `<pre>`, and because
 * `shouldRenderCode()` is `pre == null && hasContent` it takes the "already
 * prerendered" branch and adopts the empty markup instead of rendering — the
 * surface stays permanently blank/plain.
 *
 * React re-attaches refs against the same node on any remount that reuses the
 * DOM, which `StrictMode` does on every first commit (both Otto apps use it).
 * Emptying the shadow root when the surface detaches guarantees the next
 * `hydrate()` sees a clean container and performs a real render.
 */
function useShadowResetHost() {
	const hostRef = useRef<HTMLDivElement | null>(null);

	return useCallback((node: HTMLDivElement | null) => {
		if (node !== null) {
			hostRef.current = node;
			return;
		}
		const host = hostRef.current;
		hostRef.current = null;
		if (!host) return;
		for (const container of host.querySelectorAll('diffs-container')) {
			container.shadowRoot?.replaceChildren();
		}
	}, []);
}

interface DiffBoundaryProps {
	/**
	 * Compact identity of the rendered content; a change clears a previous
	 * failure. Never the raw patch text — that would retain large strings and
	 * make React keys enormous.
	 */
	contentKey: string;
	fallback: ReactNode;
	children: ReactNode;
}

/**
 * Pierre renders into a shadow DOM subtree and throws on patches it cannot
 * resolve to a singular file diff. An unexpected failure must degrade to the
 * caller's fallback instead of tearing down the surrounding panel or thread.
 */
export class PierreDiffBoundary extends Component<
	DiffBoundaryProps,
	{ failedKey: string | null }
> {
	state: { failedKey: string | null } = { failedKey: null };

	static getDerivedStateFromProps(
		props: DiffBoundaryProps,
		state: { failedKey: string | null },
	) {
		if (state.failedKey !== null && state.failedKey !== props.contentKey) {
			return { failedKey: null };
		}
		return null;
	}

	componentDidCatch() {
		this.setState({ failedKey: this.props.contentKey });
	}

	render() {
		if (this.state.failedKey === this.props.contentKey)
			return this.props.fallback;
		return this.props.children;
	}
}

export interface PierreFileContents {
	name: string;
	contents: string;
	/** Stable identity for the worker AST cache. */
	cacheKey?: string;
}

interface PierreFileDiffProps extends PierreDiffSurfaceInput {
	/** Already-parsed metadata; avoids reparsing the patch string. */
	fileDiff: FileDiffMetadata;
	fallback: ReactNode;
	className?: string;
}

/**
 * Renders one already-parsed file diff. Preferred over {@link PierrePatchDiff}
 * because the payload is parsed once during normalization and the metadata
 * carries a stable `cacheKey`.
 */
export function PierreFileDiff({
	fileDiff,
	fallback,
	className,
	variant,
	hideFileHeader,
	style,
}: PierreFileDiffProps) {
	const surface = usePierreDiffSurface({ variant, hideFileHeader, style });
	const shadowResetHost = useShadowResetHost();
	return (
		<PierreDiffBoundary
			contentKey={`${surface.themeId}:${fileDiff.cacheKey ?? fileDiff.name}`}
			fallback={fallback}
		>
			<div ref={shadowResetHost} className="contents">
				<FileDiff
					fileDiff={fileDiff}
					options={surface.options}
					className={className}
					style={surface.style}
				/>
			</div>
		</PierreDiffBoundary>
	);
}

interface PierrePatchDiffProps extends PierreDiffSurfaceInput {
	/** A single well-formed unified patch describing exactly one file. */
	patch: string;
	fallback: ReactNode;
	className?: string;
}

/**
 * Renders one unified patch through Pierre's purpose-built patch surface.
 * Prefer {@link PierreFileDiff} when the caller already has parsed metadata.
 */
export function PierrePatchDiff({
	patch,
	fallback,
	className,
	variant,
	hideFileHeader,
	style,
}: PierrePatchDiffProps) {
	const surface = usePierreDiffSurface({ variant, hideFileHeader, style });
	const patchId = useMemo(() => contentHash(patch), [patch]);
	const shadowResetHost = useShadowResetHost();
	return (
		<PierreDiffBoundary
			contentKey={`${surface.themeId}:${patchId}`}
			fallback={fallback}
		>
			<div ref={shadowResetHost} className="contents">
				<PatchDiff
					patch={patch}
					options={surface.options}
					className={className}
					style={surface.style}
				/>
			</div>
		</PierreDiffBoundary>
	);
}

interface PierreFileComparisonProps extends PierreDiffSurfaceInput {
	/**
	 * `null` represents a missing old side (a newly created file). An existing
	 * but empty file must be passed as `{ name, contents: '' }`.
	 */
	oldFile: PierreFileContents | null;
	newFile: PierreFileContents;
	fallback: ReactNode;
	className?: string;
}

/**
 * Compares two file versions directly, which gives correct language detection
 * from the filename and a true "added file" rendering when `oldFile` is null.
 */
export function PierreFileComparison({
	oldFile,
	newFile,
	fallback,
	className,
	variant,
	hideFileHeader,
	style,
}: PierreFileComparisonProps) {
	const surface = usePierreDiffSurface({ variant, hideFileHeader, style });
	const shadowResetHost = useShadowResetHost();
	const contentKey = useMemo(
		() =>
			`${newFile.cacheKey ?? contentHash(newFile.contents)}:${
				oldFile === null
					? 'new'
					: (oldFile.cacheKey ?? contentHash(oldFile.contents))
			}`,
		[newFile, oldFile],
	);
	return (
		<PierreDiffBoundary
			contentKey={`${surface.themeId}:${newFile.name}:${contentKey}`}
			fallback={fallback}
		>
			<div ref={shadowResetHost} className="contents">
				<MultiFileDiff
					oldFile={oldFile}
					newFile={newFile}
					options={surface.options}
					className={className}
					style={surface.style}
				/>
			</div>
		</PierreDiffBoundary>
	);
}
