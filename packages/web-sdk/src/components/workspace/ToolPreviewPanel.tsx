import { CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useFileContent } from '../../hooks/useFileBrowser';
import {
	type ViewerTab,
	useViewerTabsStore,
} from '../../stores/viewerTabsStore';
import { CodeMirrorViewer } from '../ui/CodeMirrorViewer';
import { StableSpinner } from '../ui/StableSpinner';
interface ToolPreviewPanelProps {
	tab: Extract<ViewerTab, { type: 'tool-preview' }>;
}

interface PatchLineHighlights {
	lines: Set<number>;
	firstLine?: number;
}

export interface LivePatchPreview {
	content: string;
	resultContent: string;
	lineTones: Map<number, 'add' | 'remove'>;
	firstLine?: number;
	latestLine?: number;
}

interface PatchOperation {
	type: 'add' | 'remove' | 'context';
	text: string;
}

const LARGE_WRITE_PREVIEW_CHARS = 24_000;
const LARGE_WRITE_PREVIEW_LINES = 500;
const STREAMING_WRITE_PREVIEW_TAIL_LINES = 250;
const LARGE_PATCH_PREVIEW_CHARS = 80_000;
const LARGE_PATCH_FILE_CHARS = 120_000;
const LARGE_PATCH_PREVIEW_TAIL_CHARS = 32_000;

interface OptimizedWritePreview {
	content: string;
	notice?: string;
	usePlainText: boolean;
}

function hasAtLeastLineCount(content: string, lineLimit: number): boolean {
	let lines = 1;
	for (let index = 0; index < content.length; index += 1) {
		if (content[index] !== '\n') continue;
		lines += 1;
		if (lines >= lineLimit) return true;
	}
	return false;
}

function getTailByLineCount(content: string, lineLimit: number): string {
	let lines = 0;
	for (let index = content.length - 1; index >= 0; index -= 1) {
		if (content[index] !== '\n') continue;
		lines += 1;
		if (lines >= lineLimit) return content.slice(index + 1);
	}
	return content;
}

function getTailByCharCount(content: string, charLimit: number): string {
	if (content.length <= charLimit) return content;
	return `… showing the latest ${charLimit.toLocaleString()} characters only …\n${content.slice(
		-charLimit,
	)}`;
}

function getOptimizedWritePreview(
	content: string,
	status: ToolPreviewPanelProps['tab']['status'],
): OptimizedWritePreview {
	const isLarge =
		content.length >= LARGE_WRITE_PREVIEW_CHARS ||
		hasAtLeastLineCount(content, LARGE_WRITE_PREVIEW_LINES);
	if (!isLarge) return { content, usePlainText: false };

	if (status !== 'streaming') {
		return {
			content,
			notice:
				'Large write preview: syntax highlighting is disabled to keep the app responsive.',
			usePlainText: true,
		};
	}

	const visibleContent = getTailByLineCount(
		content,
		STREAMING_WRITE_PREVIEW_TAIL_LINES,
	);
	return {
		content: visibleContent,
		notice:
			'Large write streaming: showing the latest content only; syntax highlighting is disabled to keep the app responsive.',
		usePlainText: true,
	};
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
	if (patch.length >= LARGE_PATCH_PREVIEW_CHARS) {
		return {
			lines: highlighted,
			firstLine: highlighted.size > 0 ? Math.min(...highlighted) : undefined,
		};
	}

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

function getPatchTextLineTones(
	patch: string | undefined,
): Map<number, 'add' | 'remove' | 'primary'> | undefined {
	if (!patch) return undefined;
	const tones = new Map<number, 'add' | 'remove' | 'primary'>();
	const lines = patch.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const lineNumber = index + 1;
		if (line.startsWith('@@') || line.startsWith('***')) {
			tones.set(lineNumber, 'primary');
		} else if (line.startsWith('+') && !line.startsWith('+++')) {
			tones.set(lineNumber, 'add');
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			tones.set(lineNumber, 'remove');
		}
	}
	return tones.size > 0 ? tones : undefined;
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
	const resultLines: string[] = [];
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
			resultLines.push(originalLines[originalIndex]);
			originalIndex += 1;
		}

		for (const operation of hunk) {
			if (operation.type === 'add') {
				renderedLines.push(operation.text);
				resultLines.push(operation.text);
				lineTones.set(renderedLines.length, 'add');
				continue;
			}

			const fallbackText = operation.text;
			renderedLines.push(originalLines[originalIndex] ?? fallbackText);
			if (operation.type === 'remove') {
				lineTones.set(renderedLines.length, 'remove');
			} else {
				resultLines.push(originalLines[originalIndex] ?? fallbackText);
			}
			originalIndex += 1;
		}
	}

	if (lineTones.size === 0) return null;

	while (originalIndex < originalLines.length) {
		renderedLines.push(originalLines[originalIndex]);
		resultLines.push(originalLines[originalIndex]);
		originalIndex += 1;
	}

	const changedLines = [...lineTones.keys()];
	return {
		content: renderedLines.join('\n'),
		resultContent: resultLines.join('\n'),
		lineTones,
		firstLine: changedLines.length > 0 ? Math.min(...changedLines) : undefined,
		latestLine: changedLines.length > 0 ? Math.max(...changedLines) : undefined,
	};
}

export function buildLivePatchPreview(
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
	const resultLines: string[] = [];
	const lineTones = new Map<number, 'add' | 'remove'>();

	const pushInsertions = (
		line: number,
		lines: string[],
		toneInsertions: boolean,
	) => {
		for (const inserted of insertions.get(line) ?? []) {
			lines.push(inserted);
			if (toneInsertions) lineTones.set(lines.length, 'add');
		}
	};

	pushInsertions(0, renderedLines, true);
	pushInsertions(0, resultLines, false);
	for (let index = 0; index < originalLines.length; index += 1) {
		const lineNumber = index + 1;
		pushInsertions(lineNumber, renderedLines, true);
		pushInsertions(lineNumber, resultLines, false);
		renderedLines.push(originalLines[index]);
		if (removals.has(lineNumber)) lineTones.set(renderedLines.length, 'remove');
		else resultLines.push(originalLines[index]);
	}
	pushInsertions(originalLines.length + 1, renderedLines, true);
	pushInsertions(originalLines.length + 1, resultLines, false);

	const changedLines = [...lineTones.keys()];
	return {
		content: renderedLines.join('\n'),
		resultContent: resultLines.join('\n'),
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

function PlainSourceViewer({
	content,
	path,
	notice,
}: {
	content: string;
	path?: string;
	notice?: string;
}) {
	return (
		<div className="h-full min-h-0 flex flex-col">
			{notice && (
				<div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
					{notice}
				</div>
			)}
			<CodeMirrorViewer content={content} path={path} />
		</div>
	);
}

interface SourceViewerProps {
	content: string;
	path?: string;
	highlightedLines?: Set<number>;
	highlightTone?: 'primary' | 'add';
	lineTones?: Map<number, 'add' | 'remove' | 'primary'>;
	scrollToLine?: number;
	scrollToEndSignal?: string | number;
}

function SourceViewer({
	content,
	path,
	highlightedLines,
	highlightTone = 'primary',
	lineTones,
	scrollToLine,
	scrollToEndSignal,
}: SourceViewerProps) {
	return (
		<CodeMirrorViewer
			content={content}
			path={path}
			highlightedLines={highlightedLines}
			highlightTone={highlightTone}
			lineTones={lineTones}
			scrollToLine={scrollToLine}
			scrollToEndSignal={scrollToEndSignal}
		/>
	);
}

export function ToolPreviewPanel({ tab }: ToolPreviewPanelProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const lastPatchPreviewRef = useRef<{
		key: string;
		preview: LivePatchPreview;
	} | null>(null);
	const statusLabel = getStatusLabel(tab);
	const shouldLoadPatchFile = tab.toolName === 'apply_patch';
	const shouldLoadAppliedFile = shouldLoadPatchFile && tab.status === 'success';
	const { data: appliedFile, refetch: refetchAppliedFile } = useFileContent(
		shouldLoadPatchFile ? tab.path : null,
	);
	const shouldUseLargePatchFallback = Boolean(
		tab.toolName === 'apply_patch' &&
			((tab.patch?.length ?? 0) >= LARGE_PATCH_PREVIEW_CHARS ||
				(appliedFile?.content?.length ?? 0) >= LARGE_PATCH_FILE_CHARS),
	);
	const largePatchPreview = useMemo(() => {
		if (!shouldUseLargePatchFallback) return null;
		return getTailByCharCount(
			tab.patch ?? 'Patch content is not available yet.',
			LARGE_PATCH_PREVIEW_TAIL_CHARS,
		);
	}, [shouldUseLargePatchFallback, tab.patch]);
	const patchHighlights = useMemo(
		() => getPatchLineHighlights(tab.patch, tab.path, tab.changedLines),
		[tab.patch, tab.path, tab.changedLines],
	);
	const patchTextLineTones = useMemo(
		() => getPatchTextLineTones(tab.patch),
		[tab.patch],
	);
	const writePreview = useMemo(
		() =>
			tab.toolName === 'write' && tab.content !== undefined
				? getOptimizedWritePreview(tab.content, tab.status)
				: null,
		[tab.toolName, tab.content, tab.status],
	);
	const scrollSignal = `${tab.content?.length ?? 0}:${tab.patch?.length ?? 0}:${appliedFile?.content?.length ?? 0}`;
	const livePatchPreview = useMemo(
		() =>
			tab.toolName === 'apply_patch' &&
			tab.status !== 'success' &&
			!shouldUseLargePatchFallback &&
			appliedFile?.content !== undefined
				? buildLivePatchPreview(
						tab.baseContent ?? appliedFile.content,
						tab.patch,
						tab.path,
					)
				: null,
		[
			tab.toolName,
			tab.status,
			tab.baseContent,
			tab.patch,
			tab.path,
			appliedFile?.content,
			shouldUseLargePatchFallback,
		],
	);
	const persistedPatchPreview = useMemo<LivePatchPreview | null>(() => {
		if (!tab.previewContent || !tab.previewLineTones) return null;
		return {
			content: tab.previewContent,
			resultContent: tab.resultContent ?? tab.previewContent,
			lineTones: new Map(tab.previewLineTones),
			firstLine: tab.previewFirstLine,
			latestLine: tab.previewLatestLine,
		};
	}, [
		tab.previewContent,
		tab.resultContent,
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
		const baseContent = tab.baseContent ?? appliedFile?.content;
		const previewLineTones = [...livePatchPreview.lineTones.entries()];
		const existingLineTones = tab.previewLineTones ?? [];
		const hasSameSnapshot =
			tab.baseContent === baseContent &&
			tab.previewContent === livePatchPreview.content &&
			tab.resultContent === livePatchPreview.resultContent &&
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
			baseContent,
			patch: tab.patch,
			changedLines: tab.changedLines,
			previewContent: livePatchPreview.content,
			resultContent: livePatchPreview.resultContent,
			previewLineTones,
			previewFirstLine: livePatchPreview.firstLine,
			previewLatestLine: livePatchPreview.latestLine,
			status: tab.status,
			error: tab.error,
		});
	}, [tab, appliedFile?.content, livePatchPreview]);

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
			{tab.error && (
				<div className="shrink-0 border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
					{tab.error}
				</div>
			)}

			<div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-auto">
				{tab.toolName === 'apply_patch' && largePatchPreview ? (
					<PlainSourceViewer
						content={largePatchPreview}
						path="preview.patch"
						notice="Large patch/file preview: showing the patch text instead of rendering the full file to keep the app responsive."
					/>
				) : tab.toolName === 'apply_patch' && stablePatchPreview ? (
					<SourceViewer
						content={stablePatchPreview.content}
						path={tab.path}
						lineTones={stablePatchPreview.lineTones}
						scrollToLine={stablePatchPreview.latestLine}
					/>
				) : tab.toolName === 'apply_patch' && tab.patch ? (
					<SourceViewer
						content={tab.patch}
						path="preview.patch"
						lineTones={patchTextLineTones}
					/>
				) : shouldLoadAppliedFile ? (
					appliedFile?.content !== undefined ? (
						<SourceViewer
							content={appliedFile.content}
							path={tab.path}
							highlightedLines={patchHighlights.lines}
							highlightTone="add"
							scrollToLine={patchHighlights.firstLine}
						/>
					) : (
						<div className="h-full flex items-center justify-center text-sm text-muted-foreground">
							Loading patched file...
						</div>
					)
				) : tab.toolName === 'apply_patch' ? (
					appliedFile?.content !== undefined ? (
						<SourceViewer content={appliedFile.content} path={tab.path} />
					) : (
						<div className="h-full flex items-center justify-center text-sm text-muted-foreground">
							Loading file...
						</div>
					)
				) : writePreview ? (
					writePreview.usePlainText ? (
						<PlainSourceViewer
							content={writePreview.content}
							path={tab.path}
							notice={writePreview.notice}
						/>
					) : (
						<SourceViewer
							content={writePreview.content}
							path={tab.path}
							scrollToEndSignal={scrollSignal}
						/>
					)
				) : (
					<div className="h-full flex items-center justify-center text-sm text-muted-foreground">
						Waiting for write content...
					</div>
				)}
			</div>

			<div className="shrink-0 border-t border-sidebar-border bg-sidebar-accent/30 px-3 py-1.5 text-[12px] text-muted-foreground flex items-center gap-2">
				<StatusIcon status={tab.status} />
				<span>{statusLabel}</span>
				<span className="text-muted-foreground/60">·</span>
				<span className="font-mono truncate" title={tab.path}>
					{tab.path}
				</span>
			</div>
		</div>
	);
}
