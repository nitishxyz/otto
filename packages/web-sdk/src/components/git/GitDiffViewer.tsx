import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
	prism,
	vscDarkPlus,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import { client } from '@ottocode/api';
import type { GitDiffResponse } from '../../types/api';
import { getRuntimeApiBaseUrl } from '../../lib/config';

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

interface DiffLine {
	oldLineNumber: number | null;
	newLineNumber: number | null;
	content: string;
	codeContent: string; // Content without +/- prefix
	type: 'header' | 'hunk' | 'add' | 'delete' | 'context' | 'meta';
}

const LANGUAGE_MAP: Record<string, string> = {
	js: 'javascript',
	jsx: 'jsx',
	ts: 'typescript',
	tsx: 'tsx',
	py: 'python',
	rb: 'ruby',
	go: 'go',
	rs: 'rust',
	java: 'java',
	c: 'c',
	cpp: 'cpp',
	h: 'c',
	hpp: 'cpp',
	cs: 'csharp',
	php: 'php',
	sh: 'bash',
	bash: 'bash',
	zsh: 'bash',
	sql: 'sql',
	json: 'json',
	yaml: 'yaml',
	yml: 'yaml',
	xml: 'xml',
	html: 'html',
	css: 'css',
	scss: 'scss',
	md: 'markdown',
	txt: 'plaintext',
	svelte: 'svelte',
};

function inferLanguageFromPath(path: string): string {
	const extension = path.split('.').pop()?.toLowerCase() ?? '';
	if (!extension) {
		return 'plaintext';
	}
	return LANGUAGE_MAP[extension] ?? 'plaintext';
}

/**
 * Get just the filename from a path
 */
function getFileName(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1];
}

export function GitDiffViewer({ diff }: GitDiffViewerProps) {
	const syntaxTheme = document?.documentElement.classList.contains('dark')
		? vscDarkPlus
		: prism;

	const resolvedLanguage =
		diff.language && diff.language.trim().length > 0
			? diff.language
			: inferLanguageFromPath(diff.file);

	// Handle new files - show full content instead of diff
	if (diff.isNewFile && diff.content) {
		return (
			<div className="flex flex-col h-full bg-transparent">
				{/* New file banner */}
				<div className="px-4 py-3 bg-green-500/10 border-b border-green-500/20">
					<p className="text-[13px] text-green-600 dark:text-green-400 font-medium">
						New file: {diff.insertions} lines
					</p>
				</div>

				{/* Full file content with syntax highlighting */}
				<div className="flex-1 overflow-auto">
					<div className="code-with-line-numbers">
						<SyntaxHighlighter
							language={resolvedLanguage}
							style={syntaxTheme}
							wrapLines
							wrapLongLines
							lineProps={() => ({
								className: 'code-line',
							})}
							customStyle={{
								margin: 0,
								padding: '1rem',
								background: 'transparent',
							}}
							codeTagProps={{
								style: {
									flex: 1,
								},
							}}
						>
							{diff.content}
						</SyntaxHighlighter>
					</div>
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

	// Parse the diff into lines with line numbers (for modified files)
	const lines = diff.diff.split('\n');
	const diffLines: DiffLine[] = [];

	let oldLineNum = 0;
	let newLineNum = 0;

	for (const line of lines) {
		const isMetadataLine =
			line.startsWith('diff') ||
			line.startsWith('index') ||
			line.startsWith('---') ||
			line.startsWith('+++');
		if (isMetadataLine) {
			continue;
		}

		if (line.startsWith('@@')) {
			// Parse hunk header to get starting line numbers
			const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (match) {
				oldLineNum = parseInt(match[1], 10);
				newLineNum = parseInt(match[2], 10);
			}
			diffLines.push({
				oldLineNumber: null,
				newLineNumber: null,
				content: line,
				codeContent: line,
				type: 'hunk',
			});
		} else if (line.startsWith('+')) {
			diffLines.push({
				oldLineNumber: null,
				newLineNumber: newLineNum,
				content: line,
				codeContent: line.slice(1), // Remove + prefix for syntax highlighting
				type: 'add',
			});
			newLineNum++;
		} else if (line.startsWith('-')) {
			diffLines.push({
				oldLineNumber: oldLineNum,
				newLineNumber: null,
				content: line,
				codeContent: line.slice(1), // Remove - prefix for syntax highlighting
				type: 'delete',
			});
			oldLineNum++;
		} else {
			// Context line
			diffLines.push({
				oldLineNumber: oldLineNum,
				newLineNumber: newLineNum,
				content: line,
				codeContent: line,
				type: 'context',
			});
			oldLineNum++;
			newLineNum++;
		}
	}

	// Render a single diff line with syntax highlighting
	const renderLine = (diffLine: DiffLine, index: number) => {
		let rowClassName = 'flex hover:bg-muted/20';
		let lineNumberClassName =
			'flex-shrink-0 w-14 px-2 py-0.5 text-[13px] font-mono select-none text-right';
		let signClassName =
			'flex-shrink-0 w-8 px-2 py-0.5 text-[13px] font-mono select-none border-r border-border text-center';
		let contentClassName =
			'flex-1 px-3 py-0.5 font-mono text-[13px] whitespace-pre';

		// Apply background colors for add/delete/hunk
		if (diffLine.type === 'hunk') {
			rowClassName += ' bg-blue-500/10';
			lineNumberClassName += ' text-blue-600 dark:text-blue-400';
			signClassName += ' text-blue-600 dark:text-blue-400';
			contentClassName += ' text-blue-600 dark:text-blue-400 font-semibold';
		} else if (diffLine.type === 'add') {
			rowClassName += ' bg-green-500/10';
			lineNumberClassName += ' text-green-700 dark:text-green-400';
			signClassName += ' text-green-700 dark:text-green-400';
			contentClassName += ' text-green-700 dark:text-green-400';
		} else if (diffLine.type === 'delete') {
			rowClassName += ' bg-red-500/10';
			lineNumberClassName += ' text-red-600 dark:text-red-400';
			signClassName += ' text-red-600 dark:text-red-400';
			contentClassName += ' text-red-600 dark:text-red-400';
		} else if (diffLine.type === 'meta') {
			contentClassName += ' text-muted-foreground';
			lineNumberClassName += ' text-muted-foreground';
			signClassName += ' text-muted-foreground';
		} else {
			contentClassName += ' text-foreground/80';
			lineNumberClassName += ' text-muted-foreground';
			signClassName += ' text-muted-foreground';
		}

		const lineNumber = diffLine.newLineNumber ?? diffLine.oldLineNumber ?? '';
		const sign =
			diffLine.type === 'add' ? '+' : diffLine.type === 'delete' ? '-' : '';

		// For code lines (not meta/hunk), apply syntax highlighting
		let renderedContent: React.ReactNode = diffLine.codeContent || ' ';

		if (
			diffLine.type !== 'meta' &&
			diffLine.type !== 'hunk' &&
			resolvedLanguage !== 'plaintext' &&
			diffLine.codeContent.trim()
		) {
			renderedContent = (
				<SyntaxHighlighter
					language={resolvedLanguage}
					style={syntaxTheme}
					customStyle={{
						margin: 0,
						padding: 0,
						background: 'transparent',
						display: 'inline',
						fontSize: 'inherit',
						lineHeight: 'inherit',
					}}
					codeTagProps={{
						style: {
							fontFamily: 'inherit',
							background: 'transparent',
						},
					}}
					PreTag="span"
				>
					{diffLine.codeContent}
				</SyntaxHighlighter>
			);
		}

		return (
			<div key={index} className={rowClassName}>
				<div
					className={lineNumberClassName}
					aria-hidden="true"
					style={{ pointerEvents: 'none' }}
				>
					{diffLine.type === 'hunk' ? '' : lineNumber}
				</div>
				<div
					className={signClassName}
					aria-hidden="true"
					style={{ pointerEvents: 'none' }}
				>
					{sign}
				</div>
				<div className={contentClassName}>{renderedContent}</div>
			</div>
		);
	};

	return (
		<div className="flex flex-col h-full bg-transparent">
			{/* Diff content */}
			<div className="flex-1 overflow-auto">
				{diff.diff.trim() === '' ? (
					<div className="p-4 text-[12px] text-muted-foreground">
						No changes to display
					</div>
				) : (
					<div className="min-w-max">{diffLines.map(renderLine)}</div>
				)}
			</div>
		</div>
	);
}
