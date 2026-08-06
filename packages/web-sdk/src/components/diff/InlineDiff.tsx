import type { CodeViewItem, FileDiffMetadata } from '@pierre/diffs';
import { CodeView } from '@pierre/diffs/react';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import {
	PierreDiffBoundary,
	PierreFileComparison,
	PierreFileDiff,
} from './PierreDiff';
import { usePierreDiffSurface } from './diffOptions';
import {
	contentHash,
	normalizeToolPatch,
	type NormalizedHunkStat,
	type NormalizedPatchFile,
	type PatchChangeKind,
} from './patchNormalize';

/**
 * Individual Pierre surfaces never scroll on their own: the shared viewport
 * below owns the single scrollbar for the whole tool card.
 */
const INLINE_SURFACE_STYLE: CSSProperties = {};

/**
 * Bounded viewport for a tool card's diff body.
 *
 * Base height matches the `max-h-80` used by `ToolContentBox` so narrow panes
 * and mobile stay compact; from `sm` up it grows to `max-h-[32rem]`, which is
 * already used elsewhere for roomier desktop content. Vertical overflow scrolls;
 * horizontal overflow is still handled by Pierre's `overflow: 'wrap'`.
 *
 * `overscroll-behavior` is intentionally left at its default so reaching either
 * end of the diff chains back to the chat thread, keeping the outer list usable.
 */
export const INLINE_DIFF_VIEWPORT_CLASS =
	'bg-card/60 border border-border rounded-lg max-w-full min-w-0 overflow-y-auto overflow-x-hidden max-h-80 sm:max-h-[32rem]';

/**
 * The single bounding box around a tool card's whole diff body. Every per-file
 * section lives inside it, so one tool call has exactly one scrollbar.
 */
function InlineDiffViewport({ children }: { children: ReactNode }) {
	return <div className={INLINE_DIFF_VIEWPORT_CLASS}>{children}</div>;
}

/**
 * Visible +/- text rendering used whenever a payload cannot be turned into a
 * valid Pierre model. Never renders an empty shell. Borderless because the
 * surrounding viewport already draws the bounding box.
 */
function PlainPatchFallback({ patch }: { patch: string }) {
	const lines = useMemo(() => patch.split('\n'), [patch]);
	return (
		<div className="min-w-0 px-3 py-2 font-mono text-[11px] leading-[1.25rem]">
			{lines.map((line, index) => {
				const tone = line.startsWith('+')
					? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
					: line.startsWith('-')
						? 'bg-red-500/10 text-red-600 dark:text-red-300'
						: line.startsWith('@@') || line.startsWith('***')
							? 'text-muted-foreground/80'
							: 'text-foreground/80';
				return (
					<div
						key={`${index}-${line.slice(0, 16)}`}
						className={`whitespace-pre-wrap break-words px-1 ${tone}`}
					>
						{line === '' ? '\u00a0' : line}
					</div>
				);
			})}
		</div>
	);
}

const KIND_BADGE: Record<PatchChangeKind, string | undefined> = {
	add: 'added',
	delete: 'deleted',
	rename: 'renamed',
	update: undefined,
};

function formatSpan(start: number, count: number): string {
	if (count <= 1) return `${start}`;
	return `${start}-${start + count - 1}`;
}

/** Matches the existing apply-patch hunk chip label format. */
export function formatHunkLabel(hunk: NormalizedHunkStat): string {
	const left = `-${formatSpan(hunk.oldStart, hunk.oldLines)}`;
	const right = `+${formatSpan(hunk.newStart, hunk.newLines)}`;
	const deltaParts: string[] = [];
	if (hunk.additions > 0) deltaParts.push(`+${hunk.additions}`);
	if (hunk.deletions > 0) deltaParts.push(`-${hunk.deletions}`);
	const delta = deltaParts.length > 0 ? ` (${deltaParts.join(', ')})` : '';
	return `${left} ${right}${delta}`;
}

function FilePathRow({ file }: { file: NormalizedPatchFile }) {
	const badge = KIND_BADGE[file.kind];
	return (
		<div className="flex min-w-0 items-center gap-2">
			<span
				className="min-w-0 flex-1 truncate font-mono text-foreground/80"
				title={
					file.previousPath ? `${file.previousPath} → ${file.path}` : file.path
				}
			>
				{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
			</span>
			{badge ? (
				<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
					{badge}
				</span>
			) : null}
		</div>
	);
}

function HunkChips({ hunks }: { hunks: NormalizedHunkStat[] }) {
	if (hunks.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-2">
			{hunks.map((hunk, index) => (
				<span
					key={`hunk-${hunk.oldStart}-${hunk.newStart}-${index}`}
					className="rounded bg-muted px-2 py-0.5 text-[0.65rem] font-mono text-muted-foreground"
				>
					{formatHunkLabel(hunk)}
				</span>
			))}
		</div>
	);
}

/** Header/chips block shown above each file's diff. */
function FileSectionHeader({
	file,
	showPathRow,
}: {
	file: NormalizedPatchFile;
	showPathRow: boolean;
}) {
	if (!showPathRow && file.hunks.length === 0) return null;
	return (
		<div className="min-w-0 space-y-1 px-3 pt-2">
			{showPathRow ? <FilePathRow file={file} /> : null}
			<HunkChips hunks={file.hunks} />
		</div>
	);
}

/**
 * One file operation: path row, hunk chips, then that file's own diff. The
 * filename row and chips scroll with the diff so each file stays identifiable.
 * Files are separated by a divider rather than nested borders, keeping a single
 * bounding box for the card.
 *
 * The diff renders from metadata parsed once during normalization, so the patch
 * string is never reparsed here, and the metadata's stable `cacheKey` lets the
 * worker pool reuse the highlighted AST across collapse/reopen.
 */
function PatchFileSection({
	file,
	showPathRow,
	isFirst,
}: {
	file: NormalizedPatchFile;
	showPathRow: boolean;
	isFirst: boolean;
}) {
	return (
		<div
			className={
				isFirst ? 'min-w-0 pb-2' : 'min-w-0 border-t border-border pb-2'
			}
		>
			<FileSectionHeader file={file} showPathRow={showPathRow} />
			{file.renderable && file.fileDiff ? (
				<PierreFileDiff
					fileDiff={file.fileDiff}
					variant="inline"
					style={INLINE_SURFACE_STYLE}
					fallback={<PlainPatchFallback patch={file.text} />}
				/>
			) : (
				<PlainPatchFallback patch={file.text} />
			)}
		</div>
	);
}

/**
 * Every file rendered through one virtualizing `CodeView`, which is itself the
 * single bounded scroll root for the tool call.
 *
 * CodeView derives its virtual window from its own root element's height
 * (`root.getBoundingClientRect().height`), so it must own the bounded box:
 * nesting it inside another scroller would report a zero-height viewport and
 * defeat virtualization, as well as produce two scrollbars. It sets an explicit
 * height on its inner container, so a short diff still collapses to its content
 * rather than leaving an oversized empty box.
 *
 * Offscreen files are not mounted or highlighted until they scroll near the
 * viewport, which is the reason this is preferred over one surface per file.
 */
function VirtualizedPatchDiff({
	files,
	showPathRow,
	fallback,
}: {
	files: NormalizedPatchFile[];
	showPathRow: boolean;
	fallback: ReactNode;
}) {
	// `disableFileHeader` must stay false or Pierre skips the header slot
	// entirely, including the custom one rendered below.
	const surface = usePierreDiffSurface({
		variant: 'inline',
		hideFileHeader: false,
	});

	// Items carry the metadata parsed once during normalization; the stable
	// `id` and content-derived `cacheKey` let CodeView and the worker AST cache
	// reuse work across rerenders and collapse/reopen.
	const items = useMemo<CodeViewItem[]>(
		() =>
			files.map((file) => ({
				id: file.id,
				type: 'diff' as const,
				// Callers only pass files whose `renderable` is true.
				fileDiff: file.fileDiff as FileDiffMetadata,
			})),
		[files],
	);

	const byId = useMemo(
		() => new Map(files.map((file) => [file.id, file])),
		[files],
	);

	const renderCustomHeader = useCallback(
		(item: CodeViewItem) => {
			const file = byId.get(item.id);
			if (!file) return null;
			return <FileSectionHeader file={file} showPathRow={showPathRow} />;
		},
		[byId, showPathRow],
	);

	const contentKey = useMemo(
		() =>
			`${items.length}:${items[0]?.id ?? ''}:${items[items.length - 1]?.id ?? ''}`,
		[items],
	);

	return (
		<PierreDiffBoundary contentKey={contentKey} fallback={fallback}>
			<CodeView
				items={items}
				options={surface.options}
				className={INLINE_DIFF_VIEWPORT_CLASS}
				style={surface.style}
				renderCustomHeader={renderCustomHeader}
			/>
		</PierreDiffBoundary>
	);
}

export interface InlinePatchDiffProps {
	/** Raw patch payload from a tool artifact or tool arguments. */
	patch: string;
	/** Used when the payload carries hunks but no filename. */
	fallbackPath?: string;
	/**
	 * Set when the surrounding renderer already displays the filename, so the
	 * per-file path row is suppressed for single-file payloads. Multi-file
	 * payloads always show their own path rows.
	 */
	hidePathHeader?: boolean;
}

/**
 * Renders every file operation in one tool patch payload, in source order.
 * A single `apply_patch` call may touch many files with many hunks each and
 * mix add/update/delete; all of them render, each with its own diff surface.
 */
export function InlinePatchDiff({
	patch,
	fallbackPath,
	hidePathHeader,
}: InlinePatchDiffProps) {
	const files = useMemo(
		() => normalizeToolPatch(patch, fallbackPath),
		[patch, fallbackPath],
	);

	if (files.length === 0) {
		return (
			<InlineDiffViewport>
				<PlainPatchFallback patch={patch} />
			</InlineDiffViewport>
		);
	}

	const showPathRow = !(hidePathHeader && files.length === 1);

	// Every file section shares one viewport, so a multi-file apply_patch has a
	// single scrollbar rather than one per file. Each file renders from metadata
	// parsed once during normalization, so no patch string is reparsed here.
	const sections = (
		<InlineDiffViewport>
			<div className="flex min-w-0 flex-col">
				{files.map((file, index) => (
					<PatchFileSection
						key={file.id}
						file={file}
						showPathRow={showPathRow}
						isFirst={index === 0}
					/>
				))}
			</div>
		</InlineDiffViewport>
	);

	// Virtualize once a call touches several files, which is where eager
	// mounting actually hurts. CodeView items must all be Pierre models, so a
	// payload containing a malformed operation keeps the non-virtualized
	// layout; that only happens for raw `*** Replace in:`-style argument
	// previews, never for the normalized artifact a chat card renders.
	const canVirtualize =
		files.length > 1 && files.every((file) => file.renderable && file.fileDiff);
	if (!canVirtualize) return sections;

	return (
		<VirtualizedPatchDiff
			files={files}
			showPathRow={showPathRow}
			fallback={sections}
		/>
	);
}

export interface InlineFileWriteDiffProps {
	path: string;
	/** Full content written by the tool. */
	content: string;
	/**
	 * Previous content. Pass `null` when the file did not exist, and `''` for an
	 * existing but empty file — the two render differently.
	 */
	previousContent?: string | null;
	/** Rendered when the diff surface cannot be used. */
	fallback?: ReactNode;
	hidePathHeader?: boolean;
}

/**
 * Renders a whole-file write as a direct file comparison. A created file has no
 * old side, so every line renders as an addition with the language inferred
 * from the filename.
 */
export function InlineFileWriteDiff({
	path,
	content,
	previousContent = null,
	fallback,
	hidePathHeader,
}: InlineFileWriteDiffProps) {
	// Content-derived cache keys let the worker pool reuse the highlighted AST
	// across collapse/reopen and rerenders of the same write.
	const newFile = useMemo(
		() => ({
			name: path,
			contents: content,
			cacheKey: `w:${contentHash(path)}:${contentHash(content)}`,
		}),
		[path, content],
	);
	const oldFile = useMemo(
		() =>
			previousContent === null
				? null
				: {
						name: path,
						contents: previousContent,
						cacheKey: `w:${contentHash(path)}:${contentHash(previousContent)}`,
					},
		[path, previousContent],
	);

	// An empty write has no lines to render; show the text fallback instead of
	// an empty diff shell.
	if (content.length === 0) {
		return (
			<InlineDiffViewport>
				{fallback ?? <PlainPatchFallback patch={content} />}
			</InlineDiffViewport>
		);
	}

	return (
		<InlineDiffViewport>
			<div className="min-w-0 space-y-1 px-3 py-2">
				{hidePathHeader ? null : (
					<FilePathRow
						file={
							{
								id: path,
								path,
								kind: previousContent === null ? 'add' : 'update',
								patch: '',
								text: '',
								renderable: true,
								additions: 0,
								deletions: 0,
								hunks: [],
							} satisfies NormalizedPatchFile
						}
					/>
				)}
				<PierreFileComparison
					oldFile={oldFile}
					newFile={newFile}
					variant="inline"
					style={INLINE_SURFACE_STYLE}
					fallback={fallback ?? <PlainPatchFallback patch={content} />}
				/>
			</div>
		</InlineDiffViewport>
	);
}
