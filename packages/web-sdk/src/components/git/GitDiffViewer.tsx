import { client } from '@ottocode/api';
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

function getDiffLineTones(diffText: string): Map<number, CodeMirrorLineTone> {
	const tones = new Map<number, CodeMirrorLineTone>();
	const lines = diffText.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const lineNumber = index + 1;
		if (line.startsWith('@@')) {
			tones.set(lineNumber, 'primary');
		} else if (line.startsWith('+') && !line.startsWith('+++')) {
			tones.set(lineNumber, 'add');
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			tones.set(lineNumber, 'remove');
		}
	}
	return tones;
}

export function GitDiffViewer({ diff }: GitDiffViewerProps) {
	// Handle new files - show full content instead of diff
	if (diff.isNewFile && diff.content) {
		return (
			<div className="flex flex-col h-full bg-transparent">
				<div className="px-4 py-3 bg-green-500/10 border-b border-green-500/20">
					<p className="text-[13px] text-green-600 dark:text-green-400 font-medium">
						New file: {diff.insertions} lines
					</p>
				</div>

				<div className="flex-1 min-h-0">
					<CodeMirrorViewer
						content={diff.content}
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

	return (
		<div className="flex flex-col h-full bg-transparent">
			<div className="flex-1 min-h-0">
				{diff.diff.trim() === '' ? (
					<div className="p-4 text-[12px] text-muted-foreground">
						No changes to display
					</div>
				) : (
					<CodeMirrorViewer
						content={diff.diff}
						path={diff.file}
						lineTones={getDiffLineTones(diff.diff)}
						disableMarkdownSyntax
					/>
				)}
			</div>
		</div>
	);
}
