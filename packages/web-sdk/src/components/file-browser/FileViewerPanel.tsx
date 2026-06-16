import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentPropsWithoutRef,
} from 'react';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBtwStore } from '../../stores/btwStore';
import { useFileBrowserStore } from '../../stores/fileBrowserStore';
import {
	NEW_SESSION_FILE_SELECTIONS_KEY,
	useFileSelectionStore,
} from '../../stores/fileSelectionStore';
import { useGitStore } from '../../stores/gitStore';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import type {
	ToolActivityAnnotation,
	ToolActivityHighlight,
	ToolPatchPreview,
	ToolWritePreview,
} from '../../stores/viewerTabsStore';
import type { CodeMirrorTextSelection } from '../../lib/fileSelectionContext';
import { createFileSelectionContext } from '../../lib/fileSelectionContext';
import { useFileContent } from '../../hooks/useFileBrowser';
import { Button } from '../ui/Button';
import { CodeMirrorViewer } from '../ui/CodeMirrorViewer';
import { buildLivePatchPreview } from '../workspace/ToolPreviewPanel';
import {
	ViewerStatusBar,
	countLineTones,
	countPatchTextChanges,
	normalizeChangeCount,
} from '../workspace/ViewerStatusBar';
import { getBaseUrl } from '../../lib/api-client/utils';
import { toast } from '../../stores/toastStore';

const IMAGE_EXTENSIONS = new Set([
	'avif',
	'bmp',
	'gif',
	'ico',
	'jpeg',
	'jpg',
	'png',
	'svg',
	'webp',
]);

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
};

function getFileExtension(path: string): string {
	return path.split('.').pop()?.toLowerCase() ?? '';
}

function inferLanguage(path: string): string {
	const ext = getFileExtension(path);
	return LANGUAGE_MAP[ext] ?? 'plaintext';
}

function isMarkdownFile(path: string): boolean {
	const ext = getFileExtension(path);
	return ext === 'md' || ext === 'markdown' || ext === 'mdx';
}

function isImageFile(path: string): boolean {
	return IMAGE_EXTENSIONS.has(getFileExtension(path));
}

function formatReadHighlightLabel(highlight: ToolActivityHighlight): string {
	if (highlight.startLine && highlight.endLine) {
		return highlight.startLine === highlight.endLine
			? `Reading line ${highlight.startLine}`
			: `Reading lines ${highlight.startLine}-${highlight.endLine}`;
	}

	if (highlight.startLine) return `Reading line ${highlight.startLine}`;
	return 'Reading file';
}

function formatPatchPreviewLabel(preview: ToolPatchPreview): string {
	const label =
		preview.toolName === 'edit'
			? 'Edit'
			: preview.toolName === 'multiedit'
				? 'Multi-edit'
				: 'Patch';
	if (preview.status === 'success') return `${label} applied`;
	if (preview.status === 'error') return `${label} failed`;
	return `${label} preview`;
}

function formatWritePreviewLabel(preview: ToolWritePreview): string {
	if (preview.status === 'success') return 'Write applied';
	if (preview.status === 'error') return 'Write failed';
	return 'Writing file';
}

function countTextLines(content: string | undefined): number {
	if (content === undefined) return 0;
	return content.length === 0 ? 1 : content.split('\n').length;
}

interface FileViewerPanelProps {
	mode?: 'overlay' | 'pane';
	open?: boolean;
	file?: string | null;
	highlight?: ToolActivityHighlight;
	annotations?: ToolActivityAnnotation[];
	patchPreview?: ToolPatchPreview;
	writePreview?: ToolWritePreview;
	onClose?: () => void;
}

interface SelectionToolbarState {
	top: number;
	left: number;
}

export const FileViewerPanel = memo(function FileViewerPanel({
	mode = 'overlay',
	open,
	file,
	highlight,
	annotations,
	patchPreview,
	writePreview,
	onClose,
}: FileViewerPanelProps = {}) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const latestAnchorRectRef = useRef<{
		top: number;
		left: number;
		bottom: number;
		right: number;
	} | null>(null);
	const [selectionToolbar, setSelectionToolbar] =
		useState<SelectionToolbarState | null>(null);
	const storeIsViewerOpen = useFileBrowserStore((s) => s.isViewerOpen);
	const storeSelectedFile = useFileBrowserStore((s) => s.selectedFile);
	const storeCloseViewer = useFileBrowserStore((s) => s.closeViewer);
	const setActiveSelection = useFileSelectionStore((s) => s.setActiveSelection);
	const isViewerOpen = open ?? storeIsViewerOpen;
	const selectedFile = file ?? storeSelectedFile;
	const closeViewer = onClose ?? storeCloseViewer;
	const selectedFileIsImage = selectedFile ? isImageFile(selectedFile) : false;

	const { data, isLoading } = useFileContent(
		selectedFileIsImage ? null : selectedFile,
	);

	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const isInInput =
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable;
			if (
				(e.key === 'Escape' || (e.key === 'q' && !isInInput)) &&
				isViewerOpen
			) {
				closeViewer();
			}
		};

		document.addEventListener('keydown', handleEscape);
		return () => document.removeEventListener('keydown', handleEscape);
	}, [isViewerOpen, closeViewer]);

	const openBtwForActiveSelection = useCallback(() => {
		if (!isViewerOpen || !selectedFile) return;

		const selection = useFileSelectionStore.getState().activeSelection;
		if (!selection || selection.filePath !== selectedFile) {
			toast.error('Select text in the file viewer first');
			return;
		}

		useBtwStore.getState().open({
			selection,
			parentSessionId: useGitStore.getState().activeSessionId,
			anchorRect: latestAnchorRectRef.current,
		});
		setSelectionToolbar(null);
	}, [isViewerOpen, selectedFile]);

	const attachActiveSelection = useCallback(() => {
		if (!isViewerOpen || !selectedFile) return;

		const selectionState = useFileSelectionStore.getState();
		const selection = selectionState.activeSelection;
		if (!selection || selection.filePath !== selectedFile) {
			toast.error('Select text in the file viewer first');
			return;
		}

		const sessionId =
			useGitStore.getState().activeSessionId ?? NEW_SESSION_FILE_SELECTIONS_KEY;

		selectionState.attachSelectionToSession(sessionId, selection);
		setSelectionToolbar(null);
		toast.success(`Attached ${selection.label}`);
		window.setTimeout(() => {
			document.querySelector<HTMLTextAreaElement>('textarea')?.focus();
		}, 0);
	}, [isViewerOpen, selectedFile]);

	const handleSelectionChange = useCallback(
		(selection: CodeMirrorTextSelection | null) => {
			if (!selectedFile || !selection) {
				setActiveSelection(null);
				setSelectionToolbar(null);
				latestAnchorRectRef.current = null;
				return;
			}

			const fileSelection = createFileSelectionContext(selectedFile, selection);
			setActiveSelection(fileSelection);

			if (!selection.anchorRect) {
				setSelectionToolbar(null);
				latestAnchorRectRef.current = null;
				return;
			}
			latestAnchorRectRef.current = selection.anchorRect;

			const toolbarWidth = 230;
			setSelectionToolbar({
				top: Math.max(8, selection.anchorRect.top - 44),
				left: Math.max(
					8,
					Math.min(
						window.innerWidth - toolbarWidth - 8,
						(selection.anchorRect.left + selection.anchorRect.right) / 2 -
							toolbarWidth / 2,
					),
				),
			});
		},
		[selectedFile, setActiveSelection],
	);

	useEffect(() => {
		const handleAttachSelection = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const isInInput =
				target?.tagName === 'INPUT' ||
				target?.tagName === 'TEXTAREA' ||
				target?.isContentEditable;

			if (isInInput || event.key.toLowerCase() !== 'i') return;
			if (!event.metaKey && !event.ctrlKey) return;
			if (!isViewerOpen || !selectedFile) return;

			event.preventDefault();

			attachActiveSelection();
		};

		document.addEventListener('keydown', handleAttachSelection);
		return () => document.removeEventListener('keydown', handleAttachSelection);
	}, [attachActiveSelection, isViewerOpen, selectedFile]);

	useEffect(() => {
		const handleOpenBtw = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const isInInput =
				target?.tagName === 'INPUT' ||
				target?.tagName === 'TEXTAREA' ||
				target?.isContentEditable;

			if (isInInput || event.key.toLowerCase() !== 'k') return;
			if (!event.metaKey && !event.ctrlKey) return;
			if (!isViewerOpen || !selectedFile) return;

			event.preventDefault();
			openBtwForActiveSelection();
		};

		document.addEventListener('keydown', handleOpenBtw);
		return () => document.removeEventListener('keydown', handleOpenBtw);
	}, [isViewerOpen, openBtwForActiveSelection, selectedFile]);

	const effectiveHighlight =
		patchPreview || writePreview ? undefined : highlight;
	const persistedPatchPreview = useMemo(() => {
		if (!patchPreview?.previewContent || !patchPreview.previewLineTones) {
			return null;
		}
		return {
			content: patchPreview.previewContent,
			resultContent: patchPreview.resultContent ?? patchPreview.previewContent,
			lineTones: new Map(patchPreview.previewLineTones),
			firstLine: patchPreview.previewFirstLine,
			latestLine: patchPreview.previewLatestLine,
		};
	}, [patchPreview]);
	const patchBaseContent = patchPreview
		? (patchPreview.baseContent ?? data?.content ?? '')
		: undefined;
	const livePatchPreview = useMemo(
		() =>
			selectedFile && patchPreview?.patch && patchBaseContent !== undefined
				? buildLivePatchPreview(
						patchBaseContent,
						patchPreview.patch,
						selectedFile,
					)
				: null,
		[selectedFile, patchPreview?.patch, patchBaseContent],
	);
	const activePatchPreview =
		patchPreview?.status === 'success'
			? (persistedPatchPreview ?? livePatchPreview)
			: (livePatchPreview ?? persistedPatchPreview);

	useEffect(() => {
		if (!selectedFile || !patchPreview || !livePatchPreview) return;
		const baseContent = patchPreview.baseContent ?? data?.content;
		const previewLineTones = [...livePatchPreview.lineTones.entries()];
		const existingLineTones = patchPreview.previewLineTones ?? [];
		const hasSameSnapshot =
			patchPreview.baseContent === baseContent &&
			patchPreview.previewContent === livePatchPreview.content &&
			patchPreview.resultContent === livePatchPreview.resultContent &&
			patchPreview.previewFirstLine === livePatchPreview.firstLine &&
			patchPreview.previewLatestLine === livePatchPreview.latestLine &&
			existingLineTones.length === previewLineTones.length &&
			existingLineTones.every(
				(entry, index) =>
					entry[0] === previewLineTones[index]?.[0] &&
					entry[1] === previewLineTones[index]?.[1],
			);
		if (hasSameSnapshot) return;
		useViewerTabsStore.getState().openToolPreviewTab({
			path: selectedFile,
			toolName: patchPreview.toolName,
			callId: patchPreview.callId,
			baseContent,
			patch: patchPreview.patch,
			changedLines: patchPreview.changedLines,
			previewContent: livePatchPreview.content,
			resultContent: livePatchPreview.resultContent,
			previewLineTones,
			previewFirstLine: livePatchPreview.firstLine,
			previewLatestLine: livePatchPreview.latestLine,
			status: patchPreview.status,
			error: patchPreview.error,
		});
	}, [selectedFile, data?.content, patchPreview, livePatchPreview]);

	useEffect(() => {
		if (!selectedFile) return;
		setActiveSelection(null);
		setSelectionToolbar(null);
		return () => {
			setActiveSelection(null);
			setSelectionToolbar(null);
		};
	}, [selectedFile, setActiveSelection]);

	useEffect(() => {
		if (!data || !effectiveHighlight?.startLine) return;

		const frame = window.requestAnimationFrame(() => {
			const target = scrollContainerRef.current?.querySelector(
				`[data-line-number="${effectiveHighlight.startLine}"]`,
			);
			if (target instanceof HTMLElement) {
				target.scrollIntoView({ block: 'center', behavior: 'smooth' });
			}
		});

		return () => window.cancelAnimationFrame(frame);
	}, [data, effectiveHighlight?.startLine]);

	const highlightStart = effectiveHighlight?.startLine;
	const highlightEnd = effectiveHighlight?.endLine ?? highlightStart;
	const patchChangedLines = patchPreview?.changedLines;
	const persistentLineTones = useMemo(() => {
		if (!annotations?.length) return undefined;
		const tones = new Map<number, 'add' | 'remove'>();
		for (const annotation of annotations) {
			for (const [line, tone] of annotation.lineTones) {
				if (line > 0) tones.set(line, tone);
			}
		}
		return tones.size > 0 ? tones : undefined;
	}, [annotations]);
	const writePreviewLineTones = useMemo(() => {
		if (writePreview?.content === undefined) return undefined;
		const tones = new Map<number, 'add' | 'remove'>();
		const lineCount =
			writePreview.content.length === 0
				? 1
				: writePreview.content.split('\n').length;
		for (let line = 1; line <= lineCount; line += 1) tones.set(line, 'add');
		return tones;
	}, [writePreview?.content]);
	const highlightedLines = useMemo(() => {
		if (highlightStart && highlightEnd) {
			return new Set(
				Array.from(
					{ length: highlightEnd - highlightStart + 1 },
					(_, index) => highlightStart + index,
				),
			);
		}

		if (!activePatchPreview && patchChangedLines?.length) {
			return new Set(patchChangedLines);
		}

		return undefined;
	}, [highlightStart, highlightEnd, activePatchPreview, patchChangedLines]);
	const fallbackPatchHighlightStart =
		!activePatchPreview && patchChangedLines?.length
			? Math.min(...patchChangedLines)
			: undefined;
	const scrollToHighlightLine = highlightStart ?? fallbackPatchHighlightStart;
	const activePatchLineTones = useMemo(() => {
		if (!activePatchPreview) return persistentLineTones;
		const tones = new Map(persistentLineTones);
		for (const [line, tone] of activePatchPreview.lineTones) {
			tones.set(line, tone);
		}
		for (const line of patchChangedLines ?? []) {
			if (!tones.has(line)) tones.set(line, 'add');
		}
		return tones;
	}, [activePatchPreview, patchChangedLines, persistentLineTones]);
	const patchChangeCount = useMemo(() => {
		const patchTextCount = countPatchTextChanges(
			patchPreview?.patch,
			selectedFile,
		);
		if (patchTextCount) return patchTextCount;

		const counts = countLineTones(
			activePatchPreview?.lineTones ?? patchPreview?.previewLineTones,
		);
		const lineToneCount = normalizeChangeCount(counts);
		if (!lineToneCount) {
			return patchChangedLines?.length
				? { additions: patchChangedLines.length, removals: 0 }
				: undefined;
		}
		return lineToneCount;
	}, [
		patchPreview?.patch,
		selectedFile,
		activePatchPreview?.lineTones,
		patchPreview?.previewLineTones,
		patchChangedLines,
	]);
	const writeChangeCount = useMemo(() => {
		if (writePreview?.changeCount) return writePreview.changeCount;
		if (writePreview?.content === undefined) return undefined;
		return {
			additions: countTextLines(writePreview.content),
			removals: data?.lineCount ?? 0,
		};
	}, [writePreview?.changeCount, writePreview?.content, data?.lineCount]);
	const writeScrollSignal =
		writePreview?.content === undefined
			? undefined
			: `${writePreview.callId ?? selectedFile}:${writePreview.status}:${writePreview.content.length}`;

	if (!isViewerOpen || !selectedFile) return null;

	const language = selectedFileIsImage ? 'image' : inferLanguage(selectedFile);
	const rawImageUrl = selectedFileIsImage
		? `${getBaseUrl()}/v1/files/raw?path=${encodeURIComponent(selectedFile)}`
		: null;
	const renderMarkdown =
		isMarkdownFile(selectedFile) &&
		!effectiveHighlight &&
		!persistentLineTones &&
		!activePatchPreview &&
		!writePreview?.content;

	return (
		<div
			className={
				mode === 'pane'
					? 'h-full w-full bg-transparent flex flex-col'
					: 'absolute inset-0 bg-background z-50 flex flex-col animate-in slide-in-from-left duration-300'
			}
		>
			{selectionToolbar ? (
				<div
					role="toolbar"
					aria-label="Selection actions"
					className="fixed z-[80] flex items-center gap-1 rounded-xl border border-border bg-popover/95 p-1 text-popover-foreground shadow-xl backdrop-blur"
					style={{
						top: selectionToolbar.top,
						left: selectionToolbar.left,
					}}
					onMouseDown={(event) => event.preventDefault()}
				>
					<button
						type="button"
						onClick={attachActiveSelection}
						className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
						title="Attach selected text to current chat"
					>
						<span>Add to Chat</span>
						<kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
							⌘I
						</kbd>
					</button>
					<button
						type="button"
						onClick={openBtwForActiveSelection}
						className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
						title="Ask BTW about selected text"
					>
						<span>BTW</span>
						<kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
							⌘K
						</kbd>
					</button>
				</div>
			) : null}
			{mode !== 'pane' && (
				<div className="h-12 border-b border-sidebar-border px-2.5 flex items-center gap-2 shrink-0 bg-sidebar-accent/40">
					<Button
						variant="ghost"
						size="icon"
						onClick={closeViewer}
						title="Close file viewer (ESC)"
						className="h-8 w-8"
					>
						<X className="size-[17px]" />
					</Button>
					<div className="flex-1 flex items-center gap-2 min-w-0">
						<span
							className="text-[13px] font-medium text-foreground font-mono truncate"
							title={selectedFile}
						>
							{selectedFile}
						</span>
						{data && (
							<span className="text-[12px] text-muted-foreground flex-shrink-0">
								{data.lineCount} lines
							</span>
						)}
					</div>
					<span className="text-[12px] text-muted-foreground pr-1">
						{language}
					</span>
				</div>
			)}
			<div ref={scrollContainerRef} className="flex-1 overflow-auto">
				{writePreview?.content !== undefined ? (
					<CodeMirrorViewer
						content={writePreview.content}
						path={selectedFile}
						lineTones={writePreviewLineTones}
						scrollToEndSignal={writeScrollSignal}
						disableMarkdownSyntax
					/>
				) : activePatchPreview ? (
					<CodeMirrorViewer
						content={activePatchPreview.content}
						path={selectedFile}
						lineTones={activePatchLineTones}
						scrollToLine={activePatchPreview.latestLine}
						disableMarkdownSyntax
					/>
				) : isLoading ? (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						Loading file...
					</div>
				) : rawImageUrl ? (
					<div className="h-full w-full flex items-center justify-center bg-muted/20 p-6">
						<img
							src={rawImageUrl}
							alt={selectedFile}
							className="max-h-full max-w-full object-contain rounded-md shadow-sm"
						/>
					</div>
				) : data ? (
					renderMarkdown ? (
						<div className="p-4 text-[14px] text-foreground leading-6 markdown-content max-w-full overflow-x-auto">
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								components={{
									a: ({
										href,
										children,
										...props
									}: ComponentPropsWithoutRef<'a'>) => (
										<a
											href={href}
											target="_blank"
											rel="noopener noreferrer"
											onClick={(e) => {
												if (window.self !== window.top && href) {
													e.preventDefault();
													window.parent.postMessage(
														{
															type: 'otto-open-url',
															url: href,
														},
														'*',
													);
												}
											}}
											{...props}
										>
											{children}
										</a>
									),
									table: ({
										children,
										...props
									}: ComponentPropsWithoutRef<'table'>) => (
										<div className="overflow-x-auto max-w-full min-w-0 my-3">
											<table {...props}>{children}</table>
										</div>
									),
								}}
							>
								{data.content}
							</ReactMarkdown>
						</div>
					) : (
						<CodeMirrorViewer
							content={data.content}
							path={selectedFile}
							highlightedLines={highlightedLines}
							lineTones={persistentLineTones}
							scrollToLine={scrollToHighlightLine}
							disableMarkdownSyntax={isMarkdownFile(selectedFile)}
							onSelectionChange={handleSelectionChange}
						/>
					)
				) : (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						Unable to load file
					</div>
				)}
			</div>
			{writePreview ? (
				<ViewerStatusBar
					tone={
						writePreview.status === 'error'
							? 'error'
							: writePreview.status === 'success'
								? 'success'
								: 'write'
					}
					label={formatWritePreviewLabel(writePreview)}
					path={selectedFile}
					changeCount={writeChangeCount}
					showSpinner={writePreview.status === 'streaming'}
					spinnerTitle="Writing file"
				/>
			) : patchPreview ? (
				<ViewerStatusBar
					tone={
						patchPreview.status === 'error'
							? 'error'
							: patchPreview.status === 'success'
								? 'success'
								: 'patch'
					}
					label={formatPatchPreviewLabel(patchPreview)}
					path={selectedFile}
					changeCount={patchChangeCount}
					showSpinner={patchPreview.status === 'streaming'}
					spinnerTitle="Patching file"
				/>
			) : effectiveHighlight ? (
				<ViewerStatusBar
					tone="read"
					label={formatReadHighlightLabel(effectiveHighlight)}
					path={selectedFile}
					showSpinner={effectiveHighlight.status === 'streaming'}
					spinnerTitle="Reading file"
				/>
			) : (
				<ViewerStatusBar tone="neutral" path={selectedFile} />
			)}
		</div>
	);
});
