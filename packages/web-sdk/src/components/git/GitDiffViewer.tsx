import { client } from '@ottocode/api';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import type { GitDiffResponse } from '../../types/api';
import { getRuntimeApiBaseUrl } from '../../lib/config';
import { PierreFileComparison, PierreFileDiff } from '../diff/PierreDiff';
import { contentHash, normalizeGitDiffFile } from '../diff/patchNormalize';
import { CodeMirrorViewer } from '../ui/CodeMirrorViewer';
import {
	LARGE_DIFF_LIMITED_PREVIEW_CHARS,
	getFileName,
	getLimitedPreview,
	isImageFile,
} from './gitDiffPatch';

const FULL_HEIGHT_SURFACE_STYLE: CSSProperties = { height: '100%' };

interface GitDiffViewerProps {
	diff: GitDiffResponse;
}

function LargePreviewNotice({ notice }: { notice?: string }) {
	if (!notice) return null;
	return (
		<div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
			{notice}
		</div>
	);
}

function PlainDiffFallback({
	content,
	path,
}: {
	content: string;
	path: string;
}) {
	return (
		<div className="flex-1 min-h-0">
			<CodeMirrorViewer content={content} path={path} disableMarkdownSyntax />
		</div>
	);
}

function PatchGitDiffViewer({ diff }: GitDiffViewerProps) {
	// Normalized once; the metadata carries a stable cacheKey so the shared
	// worker AST cache survives reselecting the same file.
	const file = useMemo(
		() => normalizeGitDiffFile(diff.diff, diff.file),
		[diff.diff, diff.file],
	);

	if (!file?.fileDiff) {
		return (
			<div className="flex flex-col h-full bg-transparent">
				{diff.diff.trim() === '' ? (
					<div className="p-4 text-[12px] text-muted-foreground">
						No changes to display
					</div>
				) : (
					<PlainDiffFallback content={diff.diff} path="preview.diff" />
				)}
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full min-w-0 bg-transparent">
			<div className="flex-1 min-h-0 min-w-0">
				<PierreFileDiff
					fileDiff={file.fileDiff}
					className="h-full w-full"
					style={FULL_HEIGHT_SURFACE_STYLE}
					fallback={
						<PlainDiffFallback content={diff.diff} path="preview.diff" />
					}
				/>
			</div>
		</div>
	);
}

/**
 * A new/untracked file has no old side in the index, so it renders as a direct
 * comparison against `oldFile: null`: every line becomes an addition with the
 * language inferred from the filename.
 */
function NewFileGitDiffViewer({ diff }: GitDiffViewerProps) {
	const preview = getLimitedPreview(diff.content ?? '');
	const newFile = useMemo(
		() => ({
			name: diff.file,
			contents: preview.content,
			cacheKey: `g:${contentHash(diff.file)}:${contentHash(preview.content)}`,
		}),
		[diff.file, preview.content],
	);

	return (
		<div className="flex flex-col h-full min-w-0 bg-transparent">
			<div className="px-4 py-3 bg-green-500/10 border-b border-green-500/20">
				<p className="text-[13px] text-green-600 dark:text-green-400 font-medium">
					New file: {diff.insertions} lines
				</p>
			</div>
			<LargePreviewNotice notice={preview.notice} />

			<div className="flex-1 min-h-0 min-w-0">
				<PierreFileComparison
					oldFile={null}
					newFile={newFile}
					className="h-full w-full"
					style={FULL_HEIGHT_SURFACE_STYLE}
					fallback={
						<PlainDiffFallback content={preview.content} path={diff.file} />
					}
				/>
			</div>
		</div>
	);
}

export function GitDiffViewer({ diff }: GitDiffViewerProps) {
	// New/untracked text files render as an added file rather than a preview.
	if (diff.isNewFile && diff.content && !diff.isBinary) {
		return <NewFileGitDiffViewer diff={diff} />;
	}

	// Binary new files still fall through to the image/binary handling below.
	if (diff.isNewFile && diff.content && diff.isBinary) {
		const preview = getLimitedPreview(diff.content);
		return (
			<div className="flex flex-col h-full bg-transparent">
				<div className="px-4 py-3 bg-green-500/10 border-b border-green-500/20">
					<p className="text-[13px] text-green-600 dark:text-green-400 font-medium">
						New file: {diff.insertions} lines
					</p>
				</div>
				<LargePreviewNotice notice={preview.notice} />

				<div className="flex-1 min-h-0">
					<CodeMirrorViewer
						content={preview.content}
						path={diff.file}
						disableMarkdownSyntax
					/>
				</div>
			</div>
		);
	}

	// Handle binary files
	if (diff.isBinary) {
		const isImage = isImageFile(diff.file);
		const imageUrl = isImage
			? client.buildUrl({
					baseURL: getRuntimeApiBaseUrl(),
					url: '/v1/files/raw',
					query: { path: diff.file },
				})
			: null;

		return (
			<div className="flex flex-col h-full bg-transparent">
				{imageUrl ? (
					<div className="flex-1 flex items-center justify-center p-4 overflow-auto">
						<img
							src={imageUrl}
							alt={getFileName(diff.file)}
							className="max-w-full max-h-[60vh] object-contain rounded border border-border"
						/>
					</div>
				) : (
					<div className="flex-1 flex items-center justify-center">
						<div className="p-4 text-center">
							<p className="text-[13px] text-muted-foreground">
								Binary file - cannot display diff
							</p>
						</div>
					</div>
				)}
			</div>
		);
	}

	if (diff.diff.length > LARGE_DIFF_LIMITED_PREVIEW_CHARS) {
		const preview = getLimitedPreview(diff.diff);
		return (
			<div className="flex flex-col h-full bg-transparent">
				<LargePreviewNotice notice={preview.notice} />
				<PlainDiffFallback content={preview.content} path="preview.diff" />
			</div>
		);
	}

	return <PatchGitDiffViewer diff={diff} />;
}
