import { CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
	prism,
	vscDarkPlus,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useFileContent } from '../../hooks/useFileBrowser';
import {
	type ViewerTab,
	useViewerTabsStore,
} from '../../stores/viewerTabsStore';
import { StableSpinner } from '../ui/StableSpinner';

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
	markdown: 'markdown',
	mdx: 'markdown',
	txt: 'plaintext',
	svelte: 'svelte',
	toml: 'toml',
	lock: 'plaintext',
	diff: 'diff',
};

interface ToolPreviewPanelProps {
	tab: Extract<ViewerTab, { type: 'tool-preview' }>;
}

interface PatchLineHighlights {
	lines: Set<number>;
	firstLine?: number;
}

interface LivePatchPreview {
	content: string;
	lineTones: Map<number, 'add' | 'remove'>;
	firstLine?: number;
	latestLine?: number;
}

interface PatchOperation {
	type: 'add' | 'remove' | 'context';
	text: string;
}

function inferLanguage(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	return LANGUAGE_MAP[ext] ?? 'plaintext';
}

function normalizePatchPath(path: string): string {
	return path.replace(/^a\//, '').replace(/^b\//, '').trim();
}

function patchPathMatches(patchPath: string, targetPath: string): boolean {
	const normalizedPatch = normalizePatchPath(patchPath);
	const normalizedTarget = normalizePatchPath(targetPath);
	return (
		normalizedPatch === normalizedTarget ||
		normalizedPatch.endsWith(`/${normalizedTarget}`) ||
		normalizedTarget.endsWith(`/${normalizedPatch}`)
	);
}

function getStablePatchLines(patch: string): string[] {
	const lines = patch.split('\n');
	if (!patch.endsWith('\n')) lines.pop();
	return lines;
}

function getPatchLineHighlights(
	patch: string | undefined,
	targetPath: string,
	fallbackLines?: number[],
): PatchLineHighlights {
	const highlighted = new Set(fallbackLines ?? []);
	if (!patch) return { lines: highlighted };

	let activeFile = false;
	let sawFileDirective = false;
	let inHunk = false;
	let newLine = 0;

	for (const line of getStablePatchLines(patch)) {
		const directive = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
		if (directive?.[1]) {
			activeFile = patchPathMatches(directive[1], targetPath);
			sawFileDirective = true;
			inHunk = false;
			newLine = 0;
			continue;
		}

		const unifiedPath = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
		if (unifiedPath?.[1]) {
			activeFile = patchPathMatches(unifiedPath[1], targetPath);
			sawFileDirective = true;
			continue;
		}

		if (!sawFileDirective) activeFile = true;
		if (!activeFile) continue;

		const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunkMatch) {
			newLine = Number.parseInt(hunkMatch[1], 10);
			inHunk = true;
			continue;
		}

		if (!inHunk) continue;

		if (line.startsWith('+') && !line.startsWith('+++')) {
			highlighted.add(newLine);
			newLine += 1;
		} else if (!(line.startsWith('-') && !line.startsWith('---'))) {
			newLine += 1;
		}
	}

	return {
		lines: highlighted,
		firstLine: highlighted.size > 0 ? Math.min(...highlighted) : undefined,
	};
}

function findPatternStart(
	lines: string[],
	pattern: string[],
	fromIndex: number,
): number {
	if (pattern.length === 0) return fromIndex;

	for (
		let index = fromIndex;
		index <= lines.length - pattern.length;
		index += 1
	) {
		let exact = true;
		for (let offset = 0; offset < pattern.length; offset += 1) {
			if (lines[index + offset] !== pattern[offset]) {
				exact = false;
				break;
			}
		}
		if (exact) return index;
	}

	for (
		let index = fromIndex;
		index <= lines.length - pattern.length;
		index += 1
	) {
		let trimmed = true;
		for (let offset = 0; offset < pattern.length; offset += 1) {
			if (lines[index + offset].trim() !== pattern[offset].trim()) {
				trimmed = false;
				break;
			}
		}
		if (trimmed) return index;
	}

	return -1;
}

function collectEnvelopedPatchHunks(
	patch: string,
	targetPath: string,
): PatchOperation[][] {
	const hunks: PatchOperation[][] = [];
	let activeFile = false;
	let sawFileDirective = false;
	let inHunk = false;
	let current: PatchOperation[] = [];

	const flush = () => {
		if (current.length > 0) hunks.push(current);
		current = [];
	};

	for (const line of getStablePatchLines(patch)) {
		const directive = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
		if (directive?.[1]) {
			flush();
			activeFile = patchPathMatches(directive[1], targetPath);
			sawFileDirective = true;
			inHunk = activeFile;
			continue;
		}

		if (line.startsWith('***')) {
			flush();
			inHunk = false;
			continue;
		}

		if (line.startsWith('@@')) {
			if (!sawFileDirective) activeFile = true;
			if (activeFile) {
				flush();
				inHunk = true;
			}
			continue;
		}

		if (!inHunk || !activeFile) continue;

		if (line.startsWith('+') && !line.startsWith('+++')) {
			current.push({ type: 'add', text: line.slice(1) });
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			current.push({ type: 'remove', text: line.slice(1) });
		} else if (line.startsWith(' ')) {
			current.push({ type: 'context', text: line.slice(1) });
		} else if (line.trim() !== '') {
			current.push({ type: 'context', text: line });
		}
	}

	flush();
	return hunks.filter((hunk) =>
		hunk.some((operation) => operation.type !== 'context'),
	);
}

function buildEnvelopedPatchPreview(
	content: string,
	patch: string,
	targetPath: string,
): LivePatchPreview | null {
	const hunks = collectEnvelopedPatchHunks(patch, targetPath);
	if (hunks.length === 0) return null;

	const originalLines = content.split('\n');
	const renderedLines: string[] = [];
	const lineTones = new Map<number, 'add' | 'remove'>();
	let originalIndex = 0;

	for (const hunk of hunks) {
		const pattern = hunk
			.filter((operation) => operation.type !== 'add')
			.map((operation) => operation.text);
		const start = findPatternStart(originalLines, pattern, originalIndex);
		if (start === -1) continue;

		while (originalIndex < start) {
			renderedLines.push(originalLines[originalIndex]);
			originalIndex += 1;
		}

		for (const operation of hunk) {
			if (operation.type === 'add') {
				renderedLines.push(operation.text);
				lineTones.set(renderedLines.length, 'add');
				continue;
			}

			const fallbackText = operation.text;
			renderedLines.push(originalLines[originalIndex] ?? fallbackText);
			if (operation.type === 'remove') {
				lineTones.set(renderedLines.length, 'remove');
			}
			originalIndex += 1;
		}
	}

	if (lineTones.size === 0) return null;

	while (originalIndex < originalLines.length) {
		renderedLines.push(originalLines[originalIndex]);
		originalIndex += 1;
	}

	const changedLines = [...lineTones.keys()];
	return {
		content: renderedLines.join('\n'),
		lineTones,
		firstLine: changedLines.length > 0 ? Math.min(...changedLines) : undefined,
		latestLine: changedLines.length > 0 ? Math.max(...changedLines) : undefined,
	};
}

function buildLivePatchPreview(
	content: string,
	patch: string | undefined,
	targetPath: string,
): LivePatchPreview | null {
	if (!patch) return null;

	const insertions = new Map<number, string[]>();
	const removals = new Set<number>();
	let activeFile = false;
	let sawFileDirective = false;
	let inHunk = false;
	let oldLine = 0;
	let sawHunk = false;

	for (const line of getStablePatchLines(patch)) {
		const directive = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
		if (directive?.[1]) {
			activeFile = patchPathMatches(directive[1], targetPath);
			sawFileDirective = true;
			inHunk = false;
			oldLine = 0;
			continue;
		}

		const unifiedPath = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
		if (unifiedPath?.[1]) {
			activeFile = patchPathMatches(unifiedPath[1], targetPath);
			sawFileDirective = true;
			continue;
		}

		if (!sawFileDirective) activeFile = true;
		if (!activeFile) continue;

		const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
		if (hunkMatch) {
			oldLine = Number.parseInt(hunkMatch[1], 10);
			inHunk = true;
			sawHunk = true;
			continue;
		}

		if (!inHunk) continue;

		if (line.startsWith('+') && !line.startsWith('+++')) {
			const atLine = oldLine > 0 ? oldLine : 1;
			const existing = insertions.get(atLine) ?? [];
			existing.push(line.slice(1));
			insertions.set(atLine, existing);
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			if (oldLine > 0) removals.add(oldLine);
			oldLine += 1;
		} else {
			oldLine += 1;
		}
	}

	if (!sawHunk || (insertions.size === 0 && removals.size === 0)) {
		return buildEnvelopedPatchPreview(content, patch, targetPath);
	}

	const originalLines = content.split('\n');
	const renderedLines: string[] = [];
	const lineTones = new Map<number, 'add' | 'remove'>();

	const pushInsertions = (line: number) => {
		for (const inserted of insertions.get(line) ?? []) {
			renderedLines.push(inserted);
			lineTones.set(renderedLines.length, 'add');
		}
	};

	pushInsertions(0);
	for (let index = 0; index < originalLines.length; index += 1) {
		const lineNumber = index + 1;
		pushInsertions(lineNumber);
		renderedLines.push(originalLines[index]);
		if (removals.has(lineNumber)) lineTones.set(renderedLines.length, 'remove');
	}
	pushInsertions(originalLines.length + 1);

	const changedLines = [...lineTones.keys()];
	return {
		content: renderedLines.join('\n'),
		lineTones,
		firstLine: changedLines.length > 0 ? Math.min(...changedLines) : undefined,
		latestLine: changedLines.length > 0 ? Math.max(...changedLines) : undefined,
	};
}

function getStatusLabel(tab: ToolPreviewPanelProps['tab']): string {
	if (tab.status === 'error') return `${tab.toolName.replace('_', ' ')} failed`;
	if (tab.status === 'success') {
		return tab.toolName === 'write' ? 'Write applied' : 'Patch applied';
	}
	return tab.toolName === 'write' ? 'Proposed write' : 'Patch preview';
}

function StatusIcon({
	status,
}: {
	status: ToolPreviewPanelProps['tab']['status'];
}) {
	if (status === 'success') {
		return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
	}
	if (status === 'error') {
		return <XCircle className="h-3.5 w-3.5 text-red-500" />;
	}
	return (
		<StableSpinner
			size="sm"
			className="text-blue-500"
			title="Preview pending"
		/>
	);
}

interface SourceViewerProps {
	content: string;
	language: string;
	syntaxTheme: Record<string, unknown>;
	highlightedLines?: Set<number>;
	highlightTone?: 'primary' | 'add';
	lineTones?: Map<number, 'add' | 'remove' | 'primary'>;
	mode?: 'plain' | 'diff';
}

function SourceViewer({
	content,
	language,
	syntaxTheme,
	highlightedLines,
	highlightTone = 'primary',
	lineTones,
	mode = 'plain',
}: SourceViewerProps) {
	if (mode === 'diff') {
		const lines = content.split('\n');
		return (
			<div className="min-w-max">
				{lines.map((line, index) => {
					const lineNumber = index + 1;
					const tone = lineTones?.get(lineNumber);
					const isHighlighted =
						Boolean(tone) || (highlightedLines?.has(lineNumber) ?? false);
					const effectiveTone = tone ?? highlightTone;
					const isAdd = isHighlighted && effectiveTone === 'add';
					const isRemove = isHighlighted && effectiveTone === 'remove';
					const rowClassName = `flex hover:bg-muted/20 ${
						isAdd
							? 'bg-green-500/15'
							: isRemove
								? 'bg-red-500/15'
								: isHighlighted
									? 'bg-blue-500/10'
									: ''
					}`;
					const numberClassName = `flex-shrink-0 w-14 px-2 py-0.5 text-[13px] font-mono select-none text-right ${
						isAdd
							? 'text-green-700 dark:text-green-400'
							: isRemove
								? 'text-red-600 dark:text-red-400'
								: 'text-muted-foreground'
					}`;
					const signClassName = `flex-shrink-0 w-8 px-2 py-0.5 text-[13px] font-mono select-none border-r border-border text-center ${
						isAdd
							? 'text-green-700 dark:text-green-400'
							: isRemove
								? 'text-red-600 dark:text-red-400'
								: 'text-muted-foreground'
					}`;
					const contentClassName = `flex-1 px-3 py-0.5 font-mono text-[13px] whitespace-pre ${
						isAdd
							? 'text-green-700 dark:text-green-400'
							: isRemove
								? 'text-red-600 dark:text-red-400 line-through'
								: 'text-foreground/80'
					}`;
					const sign = isAdd ? '+' : isRemove ? '-' : '';

					let renderedContent: React.ReactNode = line || ' ';
					if (language !== 'plaintext' && line.trim()) {
						renderedContent = (
							<SyntaxHighlighter
								language={language}
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
								{line}
							</SyntaxHighlighter>
						);
					}

					return (
						<div
							key={lineNumber}
							className={rowClassName}
							data-line-number={lineNumber}
						>
							<div className={numberClassName}>{lineNumber}</div>
							<div className={signClassName}>{sign}</div>
							<div className={contentClassName}>{renderedContent}</div>
						</div>
					);
				})}
			</div>
		);
	}

	return (
		<div className="code-with-line-numbers">
			<SyntaxHighlighter
				language={language}
				style={syntaxTheme}
				wrapLines
				wrapLongLines
				lineProps={(lineNumber) => {
					const tone = lineTones?.get(lineNumber);
					const isHighlighted =
						Boolean(tone) || (highlightedLines?.has(lineNumber) ?? false);
					const effectiveTone = tone ?? highlightTone;
					const highlightClass = isHighlighted
						? effectiveTone === 'add'
							? 'code-line diff-line-add'
							: effectiveTone === 'remove'
								? 'code-line diff-line-remove'
								: 'code-line diff-line-highlight'
						: 'code-line';
					const highlightStyle =
						effectiveTone === 'add'
							? {
									backgroundColor: 'rgb(16 185 129 / 0.22)',
									boxShadow: 'inset 3px 0 0 rgb(16 185 129)',
								}
							: effectiveTone === 'remove'
								? {
										backgroundColor: 'rgb(239 68 68 / 0.2)',
										boxShadow: 'inset 3px 0 0 rgb(239 68 68)',
										textDecoration: 'line-through',
									}
								: {
										backgroundColor: 'hsl(var(--primary) / 0.12)',
										boxShadow: 'inset 3px 0 0 hsl(var(--primary))',
									};
					return {
						className: highlightClass,
						'data-line-number': lineNumber,
						style: isHighlighted
							? {
									...highlightStyle,
									width: '100%',
								}
							: undefined,
					};
				}}
				customStyle={{
					margin: 0,
					padding: '1rem',
					background: 'transparent',
					fontSize: '0.8125rem',
					lineHeight: '1.3125rem',
				}}
				codeTagProps={{
					style: {
						flex: 1,
					},
				}}
			>
				{content}
			</SyntaxHighlighter>
		</div>
	);
}

export function ToolPreviewPanel({ tab }: ToolPreviewPanelProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const lastPatchPreviewRef = useRef<{
		key: string;
		preview: LivePatchPreview;
	} | null>(null);
	const syntaxTheme = document?.documentElement.classList.contains('dark')
		? vscDarkPlus
		: prism;
	const language = inferLanguage(tab.path);
	const statusLabel = getStatusLabel(tab);
	const shouldLoadPatchFile = tab.toolName === 'apply_patch';
	const shouldLoadAppliedFile = shouldLoadPatchFile && tab.status === 'success';
	const { data: appliedFile, refetch: refetchAppliedFile } = useFileContent(
		shouldLoadPatchFile ? tab.path : null,
	);
	const patchHighlights = useMemo(
		() => getPatchLineHighlights(tab.patch, tab.path, tab.changedLines),
		[tab.patch, tab.path, tab.changedLines],
	);
	const scrollSignal = `${tab.content?.length ?? 0}:${tab.patch?.length ?? 0}:${appliedFile?.content?.length ?? 0}`;
	const livePatchPreview = useMemo(
		() =>
			tab.toolName === 'apply_patch' &&
			tab.status !== 'success' &&
			appliedFile?.content !== undefined
				? buildLivePatchPreview(appliedFile.content, tab.patch, tab.path)
				: null,
		[tab.toolName, tab.status, tab.patch, tab.path, appliedFile?.content],
	);
	const persistedPatchPreview = useMemo<LivePatchPreview | null>(() => {
		if (!tab.previewContent || !tab.previewLineTones) return null;
		return {
			content: tab.previewContent,
			lineTones: new Map(tab.previewLineTones),
			firstLine: tab.previewFirstLine,
			latestLine: tab.previewLatestLine,
		};
	}, [
		tab.previewContent,
		tab.previewLineTones,
		tab.previewFirstLine,
		tab.previewLatestLine,
	]);
	const patchPreviewKey = `${tab.callId ?? ''}:${tab.path}`;
	if (tab.toolName === 'apply_patch' && livePatchPreview) {
		lastPatchPreviewRef.current = {
			key: patchPreviewKey,
			preview: livePatchPreview,
		};
	}
	const stablePatchPreview =
		lastPatchPreviewRef.current?.key === patchPreviewKey
			? (livePatchPreview ?? lastPatchPreviewRef.current.preview)
			: (livePatchPreview ?? persistedPatchPreview);

	useEffect(() => {
		if (tab.toolName !== 'apply_patch' || !livePatchPreview) return;
		const previewLineTones = [...livePatchPreview.lineTones.entries()];
		const existingLineTones = tab.previewLineTones ?? [];
		const hasSameSnapshot =
			tab.previewContent === livePatchPreview.content &&
			tab.previewFirstLine === livePatchPreview.firstLine &&
			tab.previewLatestLine === livePatchPreview.latestLine &&
			existingLineTones.length === previewLineTones.length &&
			existingLineTones.every(
				(entry, index) =>
					entry[0] === previewLineTones[index]?.[0] &&
					entry[1] === previewLineTones[index]?.[1],
			);
		if (hasSameSnapshot) return;
		useViewerTabsStore.getState().openToolPreviewTab({
			path: tab.path,
			toolName: 'apply_patch',
			callId: tab.callId,
			patch: tab.patch,
			changedLines: tab.changedLines,
			previewContent: livePatchPreview.content,
			previewLineTones,
			previewFirstLine: livePatchPreview.firstLine,
			previewLatestLine: livePatchPreview.latestLine,
			status: tab.status,
			error: tab.error,
		});
	}, [tab, livePatchPreview]);

	useEffect(() => {
		if (shouldLoadAppliedFile) void refetchAppliedFile();
	}, [shouldLoadAppliedFile, refetchAppliedFile]);

	useEffect(() => {
		if (scrollSignal.length === 0) return;

		const frame = window.requestAnimationFrame(() => {
			if (shouldLoadAppliedFile && patchHighlights.firstLine) {
				const target = scrollContainerRef.current?.querySelector(
					`[data-line-number="${patchHighlights.firstLine}"]`,
				);
				if (target instanceof HTMLElement) {
					target.scrollIntoView({ block: 'center', behavior: 'smooth' });
					return;
				}
			}

			if (tab.status !== 'success' && stablePatchPreview?.latestLine) {
				const target = scrollContainerRef.current?.querySelector(
					`[data-line-number="${stablePatchPreview.latestLine}"]`,
				);
				if (target instanceof HTMLElement) {
					target.scrollIntoView({ block: 'center', behavior: 'smooth' });
					return;
				}
			}

			if (tab.toolName === 'write' && scrollContainerRef.current) {
				scrollContainerRef.current.scrollTop =
					scrollContainerRef.current.scrollHeight;
			}
		});

		return () => window.cancelAnimationFrame(frame);
	}, [
		shouldLoadAppliedFile,
		patchHighlights.firstLine,
		stablePatchPreview?.latestLine,
		tab.status,
		tab.toolName,
		scrollSignal,
	]);

	return (
		<div className="h-full w-full bg-transparent flex flex-col">
			<div className="shrink-0 border-b border-sidebar-border bg-sidebar-accent/30 px-3 py-1.5 text-[12px] text-muted-foreground flex items-center gap-2">
				<StatusIcon status={tab.status} />
				<span>{statusLabel}</span>
				<span className="text-muted-foreground/60">·</span>
				<span className="font-mono truncate" title={tab.path}>
					{tab.path}
				</span>
			</div>

			{tab.error && (
				<div className="shrink-0 border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
					{tab.error}
				</div>
			)}

			<div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-auto">
				{tab.toolName === 'apply_patch' && stablePatchPreview ? (
					<SourceViewer
						content={stablePatchPreview.content}
						language={language}
						syntaxTheme={syntaxTheme}
						lineTones={stablePatchPreview.lineTones}
						mode="diff"
					/>
				) : shouldLoadAppliedFile ? (
					appliedFile?.content !== undefined ? (
						<SourceViewer
							content={appliedFile.content}
							language={language}
							syntaxTheme={syntaxTheme}
							highlightedLines={patchHighlights.lines}
							highlightTone="add"
							mode="diff"
						/>
					) : (
						<div className="h-full flex items-center justify-center text-sm text-muted-foreground">
							Loading patched file...
						</div>
					)
				) : tab.toolName === 'apply_patch' ? (
					appliedFile?.content !== undefined ? (
						<SourceViewer
							content={appliedFile.content}
							language={language}
							syntaxTheme={syntaxTheme}
						/>
					) : (
						<div className="h-full flex items-center justify-center text-sm text-muted-foreground">
							Loading file...
						</div>
					)
				) : tab.content !== undefined ? (
					<SourceViewer
						content={tab.content}
						language={language}
						syntaxTheme={syntaxTheme}
					/>
				) : (
					<div className="h-full flex items-center justify-center text-sm text-muted-foreground">
						Waiting for write content...
					</div>
				)}
			</div>
		</div>
	);
}
