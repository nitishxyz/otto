import { client } from '@ottocode/api';
import { useCallback, useMemo } from 'react';
import type { GitDiffResponse } from '../../types/api';
import { getRuntimeApiBaseUrl } from '../../lib/config';
import {
	CodeMirrorViewer,
	type CodeMirrorLineTone,
} from '../ui/CodeMirrorViewer';

const IMAGE_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'svg',
	'webp',
	'ico',
	'bmp',
	'avif',
]);

const LARGE_DIFF_LIMITED_PREVIEW_CHARS = 200_000;
const LARGE_DIFF_NOTICE_CHARS = 500_000;
const LARGE_DIFF_TAIL_CHARS = 120_000;

function isImageFile(filePath: string): boolean {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
	return IMAGE_EXTENSIONS.has(ext);
}

interface GitDiffViewerProps {
	diff: GitDiffResponse;
}

/**
 * Get just the filename from a path
 */
function getFileName(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1];
}

function getLimitedPreview(content: string): {
	content: string;
	notice?: string;
} {
	if (content.length <= LARGE_DIFF_LIMITED_PREVIEW_CHARS) return { content };
	const notice =
		content.length >= LARGE_DIFF_NOTICE_CHARS
			? 'Very large diff/file: showing the tail only to keep the viewer responsive.'
			: 'Large diff/file: showing the tail only to keep the viewer responsive.';
	return {
		content: `… showing the latest ${LARGE_DIFF_TAIL_CHARS.toLocaleString()} characters only …\n${content.slice(
			-LARGE_DIFF_TAIL_CHARS,
		)}`,
		notice,
	};
}

interface DiffDisplay {
	content: string;
	lineNumbers: Map<number, string>;
	lineTones: Map<number, CodeMirrorLineTone>;
}

function isDiffMetadataLine(line: string): boolean {
	return (
		line.startsWith('diff --git ') ||
		line.startsWith('index ') ||
		line.startsWith('--- ') ||
		line.startsWith('+++ ') ||
		line.startsWith('new file mode ') ||
		line.startsWith('deleted file mode ') ||
		line.startsWith('old mode ') ||
		line.startsWith('new mode ') ||
		line.startsWith('similarity index ') ||
		line.startsWith('dissimilarity index ') ||
		line.startsWith('rename from ') ||
		line.startsWith('rename to ') ||
		line.startsWith('copy from ') ||
		line.startsWith('copy to ')
	);
}

function parseHunkHeader(
	line: string,
): { oldStart: number; newStart: number } | null {
	const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
	if (!match) return null;
	return {
		oldStart: Number.parseInt(match[1], 10),
		newStart: Number.parseInt(match[2], 10),
	};
}

function buildDiffDisplay(diffText: string): DiffDisplay {
	const contentLines: string[] = [];
	const lineNumbers = new Map<number, string>();
	const tones = new Map<number, CodeMirrorLineTone>();
	const lines = diffText.split('\n');
	let oldLine: number | null = null;
	let newLine: number | null = null;

	for (const line of lines) {
		if (isDiffMetadataLine(line)) continue;

		const lineNumber = contentLines.length + 1;
		const hunk = parseHunkHeader(line);
		if (hunk) {
			oldLine = hunk.oldStart;
			newLine = hunk.newStart;
			contentLines.push(line);
			lineNumbers.set(lineNumber, '');
			tones.set(lineNumber, 'primary');
			continue;
		}

		contentLines.push(line);
		if (line.startsWith('@@')) {
			lineNumbers.set(lineNumber, '');
			tones.set(lineNumber, 'primary');
		} else if (line.startsWith('+') && !line.startsWith('+++')) {
			if (newLine !== null) {
				lineNumbers.set(lineNumber, String(newLine));
				newLine += 1;
			}
			tones.set(lineNumber, 'add');
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			if (oldLine !== null) {
				lineNumbers.set(lineNumber, String(oldLine));
				oldLine += 1;
			}
			tones.set(lineNumber, 'remove');
		} else if (oldLine !== null && newLine !== null) {
			lineNumbers.set(lineNumber, String(newLine));
			oldLine += 1;
			newLine += 1;
		}
	}

	return {
		content: contentLines.join('\n'),
		lineNumbers,
		lineTones: tones,
	};
}

function NormalGitDiffViewer({ diff }: GitDiffViewerProps) {
	const display = useMemo(() => buildDiffDisplay(diff.diff), [diff.diff]);
	const lineNumberFormatter = useCallback(
		(lineNumber: number) => display.lineNumbers.get(lineNumber) ?? '',
		[display.lineNumbers],
	);

	return (
		<div className="flex flex-col h-full bg-transparent">
			<div className="flex-1 min-h-0">
				{display.content.trim() === '' ? (
					<div className="p-4 text-[12px] text-muted-foreground">
						No changes to display
					</div>
				) : (
					<CodeMirrorViewer
						content={display.content}
						path={diff.file}
						lineTones={display.lineTones}
						lineNumberFormatter={lineNumberFormatter}
						disableMarkdownSyntax
					/>
				)}
			</div>
		</div>
	);
}

export function GitDiffViewer({ diff }: GitDiffViewerProps) {
	// Handle new files - show full content instead of diff
	if (diff.isNewFile && diff.content) {
		const preview = getLimitedPreview(diff.content);
		return (
			<div className="flex flex-col h-full bg-transparent">
				<div className="px-4 py-3 bg-green-500/10 border-b border-green-500/20">
					<p className="text-[13px] text-green-600 dark:text-green-400 font-medium">
						New file: {diff.insertions} lines
					</p>
				</div>
				{preview.notice ? (
					<div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
						{preview.notice}
					</div>
				) : null}

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
				{preview.notice ? (
					<div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
						{preview.notice}
					</div>
				) : null}
				<div className="flex-1 min-h-0">
					<CodeMirrorViewer
						content={preview.content}
						path="preview.diff"
						disableMarkdownSyntax
					/>
				</div>
			</div>
		);
	}

	return <NormalGitDiffViewer diff={diff} />;
}
