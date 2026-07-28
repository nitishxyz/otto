import type { BoxRenderable, DiffRenderable } from '@opentui/core';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTheme } from '../theme.ts';

const SPLIT_VIEW_MIN_WIDTH = 120;

const EXT_TO_FILETYPE: Record<string, string> = {
	ts: 'typescript',
	tsx: 'tsx',
	js: 'javascript',
	jsx: 'jsx',
	json: 'json',
	md: 'markdown',
	yaml: 'yaml',
	yml: 'yaml',
	py: 'python',
	rs: 'rust',
	go: 'go',
	rb: 'ruby',
	sh: 'bash',
	bash: 'bash',
	zsh: 'bash',
	css: 'css',
	html: 'html',
	sql: 'sql',
	toml: 'toml',
	xml: 'xml',
	c: 'c',
	cpp: 'cpp',
	h: 'c',
	hpp: 'cpp',
	java: 'java',
	swift: 'swift',
	kt: 'kotlin',
	lua: 'lua',
	zig: 'zig',
};

function detectFiletype(filePath: string): string | undefined {
	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
	return EXT_TO_FILETYPE[ext];
}

interface FileDiff {
	filePath: string;
	kind: 'add' | 'update' | 'delete';
	unifiedDiff: string;
}

const FILE_DIRECTIVE_RE = /^\*\*\* (Update|Add|Delete) File: (.+)$/;
const REPLACE_DIRECTIVE_RE = /^\*\*\* Replace in: (.+)$/;
const FIND_MARKER = '*** Find:';
const WITH_MARKER = '*** With:';

function isEnvelopedPatch(patch: string): boolean {
	return (
		patch.includes('*** Begin Patch') ||
		patch.includes('*** Update File:') ||
		patch.includes('*** Add File:') ||
		patch.includes('*** Replace in:')
	);
}

function splitEnvelopedPatch(patch: string): FileDiff[] {
	const lines = patch.split('\n');
	const files: FileDiff[] = [];
	let currentFile: {
		path: string;
		kind: 'add' | 'update' | 'delete';
		lines: string[];
	} | null = null;

	const flush = () => {
		if (!currentFile) return;
		const header =
			currentFile.kind === 'delete'
				? `--- a/${currentFile.path}\n+++ /dev/null`
				: currentFile.kind === 'add'
					? `--- /dev/null\n+++ b/${currentFile.path}`
					: `--- a/${currentFile.path}\n+++ b/${currentFile.path}`;
		files.push({
			filePath: currentFile.path,
			kind: currentFile.kind,
			unifiedDiff: `${header}\n${currentFile.lines.join('\n')}`,
		});
		currentFile = null;
	};

	let replaceState: {
		filePath: string;
		phase: 'idle' | 'find' | 'with';
		findLines: string[];
		withLines: string[];
		hunks: string[];
	} | null = null;

	const flushReplace = () => {
		if (!replaceState) return;
		if (
			replaceState.phase === 'with' &&
			(replaceState.findLines.length || replaceState.withLines.length)
		) {
			const hunkLines: string[] = [];
			for (const l of replaceState.findLines) hunkLines.push(`-${l}`);
			for (const l of replaceState.withLines) hunkLines.push(`+${l}`);
			const oldCount = replaceState.findLines.length;
			const newCount = replaceState.withLines.length;
			replaceState.hunks.push(
				`@@ -1,${oldCount} +1,${newCount} @@\n${hunkLines.join('\n')}`,
			);
		}
		if (replaceState.hunks.length) {
			files.push({
				filePath: replaceState.filePath,
				kind: 'update',
				unifiedDiff: `--- a/${replaceState.filePath}\n+++ b/${replaceState.filePath}\n${replaceState.hunks.join('\n')}`,
			});
		}
		replaceState = null;
	};

	const flushReplaceHunk = () => {
		if (!replaceState) return;
		if (replaceState.findLines.length || replaceState.withLines.length) {
			const hunkLines: string[] = [];
			for (const l of replaceState.findLines) hunkLines.push(`-${l}`);
			for (const l of replaceState.withLines) hunkLines.push(`+${l}`);
			const oldCount = replaceState.findLines.length;
			const newCount = replaceState.withLines.length;
			replaceState.hunks.push(
				`@@ -1,${oldCount} +1,${newCount} @@\n${hunkLines.join('\n')}`,
			);
		}
		replaceState.findLines = [];
		replaceState.withLines = [];
	};

	for (const line of lines) {
		if (
			line.startsWith('*** Begin Patch') ||
			line.startsWith('*** End Patch')
		) {
			continue;
		}

		const fileMatch = line.match(FILE_DIRECTIVE_RE);
		if (fileMatch) {
			flush();
			flushReplace();
			const kind = fileMatch[1].toLowerCase() as 'add' | 'update' | 'delete';
			currentFile = { path: fileMatch[2].trim(), kind, lines: [] };
			continue;
		}

		const replaceMatch = line.match(REPLACE_DIRECTIVE_RE);
		if (replaceMatch) {
			flush();
			flushReplace();
			replaceState = {
				filePath: replaceMatch[1].trim(),
				phase: 'idle',
				findLines: [],
				withLines: [],
				hunks: [],
			};
			continue;
		}

		if (replaceState) {
			if (line.startsWith(FIND_MARKER)) {
				if (replaceState.phase === 'with') {
					flushReplaceHunk();
				}
				replaceState.phase = 'find';
				continue;
			}
			if (line.startsWith(WITH_MARKER)) {
				replaceState.phase = 'with';
				continue;
			}
			if (replaceState.phase === 'find') {
				replaceState.findLines.push(line);
				continue;
			}
			if (replaceState.phase === 'with') {
				replaceState.withLines.push(line);
				continue;
			}
			continue;
		}

		if (currentFile) {
			currentFile.lines.push(line);
		}
	}

	flush();
	flushReplace();
	return files;
}

function isStandardUnifiedDiff(patch: string): boolean {
	return (
		patch.includes('--- ') && patch.includes('+++ ') && patch.includes('@@ ')
	);
}

function extractFilePathFromUnified(patch: string): string | undefined {
	const match = patch.match(/^\+\+\+ [ab]\/(.+)$/m);
	if (match) return match[1].trim();
	const matchNoPrefix = patch.match(/^\+\+\+ (.+)$/m);
	if (matchNoPrefix && matchNoPrefix[1] !== '/dev/null')
		return matchNoPrefix[1].trim();
	return undefined;
}

function countSplitViewRows(patch: string): number {
	const lines = patch.split('\n');
	let rows = 0;
	let removed = 0;
	let added = 0;

	const flushHunk = () => {
		rows += Math.max(removed, added);
		removed = 0;
		added = 0;
	};

	for (const l of lines) {
		if (l.startsWith('@@')) {
			flushHunk();
			continue;
		}
		if (l.startsWith('---') || l.startsWith('+++')) continue;
		if (l.startsWith('-')) {
			removed++;
		} else if (l.startsWith('+')) {
			added++;
		} else if (l.startsWith(' ')) {
			flushHunk();
			rows++;
		}
	}
	flushHunk();
	return rows;
}

function countUnifiedViewRows(patch: string): number {
	return patch.split('\n').filter((line) => {
		if (line.startsWith('---') || line.startsWith('+++')) return false;
		return line.startsWith('+') || line.startsWith('-') || line.startsWith(' ');
	}).length;
}

interface DiffViewProps {
	patch: string;
	filePath?: string;
	maxHeight?: number;
}

type ScrollableRenderable = {
	scrollY: number;
	scrollHeight: number;
	height: number;
	getChildren?: () => unknown[];
};

type ScrollEvent = {
	scroll?: {
		direction?: 'up' | 'down' | string;
	};
	stopPropagation: () => void;
};

function findScrollableChild(renderable: unknown): ScrollableRenderable | null {
	if (
		typeof renderable === 'object' &&
		renderable !== null &&
		'scrollY' in renderable &&
		'scrollHeight' in renderable &&
		'height' in renderable
	) {
		return renderable as ScrollableRenderable;
	}
	const renderableWithChildren = renderable as {
		getChildren?: () => unknown[];
	};
	const children = renderableWithChildren.getChildren?.() ?? [];
	for (const child of children) {
		const found = findScrollableChild(child);
		if (found) return found;
	}
	return null;
}

function SingleDiffView({
	unifiedDiff,
	filePath,
	view,
	maxHeight = 30,
}: {
	unifiedDiff: string;
	filePath?: string;
	view: 'unified' | 'split';
	maxHeight?: number;
}) {
	const { colors, syntaxStyle } = useTheme();
	const filetype = filePath ? detectFiletype(filePath) : undefined;

	const diffRef = useRef<DiffRenderable | null>(null);

	const totalRows = useMemo(() => {
		return view === 'split'
			? countSplitViewRows(unifiedDiff)
			: countUnifiedViewRows(unifiedDiff);
	}, [unifiedDiff, view]);
	const height = useMemo(
		() => Math.min(Math.max(totalRows, 1), maxHeight),
		[totalRows, maxHeight],
	);

	const handleMouseScroll = useCallback((event: ScrollEvent) => {
		const diff = diffRef.current;
		if (!diff) return;
		const scrollable = findScrollableChild(diff);
		if (!scrollable) return;
		const viewportH = scrollable.height;
		const contentH = scrollable.scrollHeight;
		if (contentH <= viewportH) return;
		const maxScroll = contentH - viewportH;
		const direction = event.scroll?.direction;
		const scrollY = scrollable.scrollY;
		if (direction === 'up' && scrollY <= 0) return;
		if (direction === 'down' && scrollY >= maxScroll) return;
		event.stopPropagation();
	}, []);

	return (
		<box style={{ width: '100%', flexDirection: 'column' }}>
			{filePath && (
				<box style={{ height: 1, paddingLeft: 2 }}>
					<text fg={colors.fgDark}>{filePath}</text>
				</box>
			)}
			<diff
				ref={diffRef}
				style={{ width: '100%', height }}
				diff={unifiedDiff}
				onMouseScroll={handleMouseScroll}
				view={view}
				syncScroll={view === 'split'}
				filetype={filetype}
				syntaxStyle={syntaxStyle}
				showLineNumbers
				addedBg={colors.diffAddedBg}
				removedBg={colors.diffRemovedBg}
				contextBg={colors.diffContextBg}
				addedSignColor={colors.diffAddedSign}
				removedSignColor={colors.diffRemovedSign}
				lineNumberFg={colors.diffLineNumberFg}
			/>
		</box>
	);
}

export function DiffView({ patch, filePath, maxHeight = 30 }: DiffViewProps) {
	const [availableWidth, setAvailableWidth] = useState(0);
	const handleSizeChange = useCallback(function handleSizeChange(
		this: BoxRenderable,
	) {
		setAvailableWidth(this.width);
	}, []);
	const view = availableWidth >= SPLIT_VIEW_MIN_WIDTH ? 'split' : 'unified';

	const fileDiffs = useMemo(() => {
		if (isEnvelopedPatch(patch)) {
			return splitEnvelopedPatch(patch);
		}

		if (isStandardUnifiedDiff(patch)) {
			const resolvedPath = filePath ?? extractFilePathFromUnified(patch);
			return [
				{
					filePath: resolvedPath ?? 'unknown',
					kind: 'update' as const,
					unifiedDiff: patch,
				},
			];
		}

		return [
			{
				filePath: filePath ?? 'unknown',
				kind: 'update' as const,
				unifiedDiff: patch,
			},
		];
	}, [patch, filePath]);

	return (
		<box
			onSizeChange={handleSizeChange}
			style={{
				width: '100%',
				flexDirection: 'column',
				marginTop: 1,
				marginBottom: 1,
			}}
		>
			{fileDiffs.map((fd) => (
				<SingleDiffView
					key={fd.filePath}
					unifiedDiff={fd.unifiedDiff}
					filePath={fd.filePath}
					view={view}
					maxHeight={maxHeight}
				/>
			))}
		</box>
	);
}
