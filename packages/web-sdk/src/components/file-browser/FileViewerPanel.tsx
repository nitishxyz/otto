import {
	memo,
	useEffect,
	useMemo,
	useRef,
	type ComponentPropsWithoutRef,
} from 'react';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useFileBrowserStore } from '../../stores/fileBrowserStore';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import type {
	ToolActivityHighlight,
	ToolPatchPreview,
} from '../../stores/viewerTabsStore';
import { useFileContent } from '../../hooks/useFileBrowser';
import { Button } from '../ui/Button';
import { CodeMirrorViewer } from '../ui/CodeMirrorViewer';
import { StableSpinner } from '../ui/StableSpinner';
import { buildLivePatchPreview } from '../workspace/ToolPreviewPanel';

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
	if (preview.status === 'success') return 'Patch applied';
	if (preview.status === 'error') return 'Patch failed';
	return 'Patching file';
}

function ActivityPathStrip({
	label,
	path,
	showSpinner,
	spinnerTitle,
}: {
	label: string;
	path: string;
	showSpinner?: boolean;
	spinnerTitle: string;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			{showSpinner && <StableSpinner size="xs" title={spinnerTitle} />}
			<span className="shrink-0">{label}</span>
			<span className="shrink-0 opacity-60">·</span>
			<span className="min-w-0 truncate font-mono" title={path}>
				{path}
			</span>
		</div>
	);
}

interface FileViewerPanelProps {
	mode?: 'overlay' | 'pane';
	open?: boolean;
	file?: string | null;
	highlight?: ToolActivityHighlight;
	patchPreview?: ToolPatchPreview;
	onClose?: () => void;
}

export const FileViewerPanel = memo(function FileViewerPanel({
	mode = 'overlay',
	open,
	file,
	highlight,
	patchPreview,
	onClose,
}: FileViewerPanelProps = {}) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const storeIsViewerOpen = useFileBrowserStore((s) => s.isViewerOpen);
	const storeSelectedFile = useFileBrowserStore((s) => s.selectedFile);
	const storeCloseViewer = useFileBrowserStore((s) => s.closeViewer);
	const isViewerOpen = open ?? storeIsViewerOpen;
	const selectedFile = file ?? storeSelectedFile;
	const closeViewer = onClose ?? storeCloseViewer;

	const { data, isLoading } = useFileContent(selectedFile);

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

	const effectiveHighlight = patchPreview ? undefined : highlight;
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
	const livePatchPreview = useMemo(
		() =>
			data && selectedFile && patchPreview?.patch
				? buildLivePatchPreview(
						patchPreview.baseContent ?? data.content,
						patchPreview.patch,
						selectedFile,
					)
				: null,
		[data, selectedFile, patchPreview?.baseContent, patchPreview?.patch],
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
			toolName: 'apply_patch',
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
	const highlightedLines = useMemo(
		() =>
			highlightStart && highlightEnd
				? new Set(
						Array.from(
							{ length: highlightEnd - highlightStart + 1 },
							(_, index) => highlightStart + index,
						),
					)
				: undefined,
		[highlightStart, highlightEnd],
	);

	if (!isViewerOpen || !selectedFile) return null;

	const language = inferLanguage(selectedFile);
	const renderMarkdown =
		isMarkdownFile(selectedFile) && !effectiveHighlight && !activePatchPreview;

	return (
		<div
			className={
				mode === 'pane'
					? 'h-full w-full bg-transparent flex flex-col'
					: 'absolute inset-0 bg-background z-50 flex flex-col animate-in slide-in-from-left duration-300'
			}
		>
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
			{patchPreview ? (
				<div className="shrink-0 border-b border-sidebar-border bg-emerald-500/10 px-3 py-1.5 text-[12px] text-emerald-700 dark:text-emerald-300">
					<ActivityPathStrip
						label={formatPatchPreviewLabel(patchPreview)}
						path={selectedFile}
						showSpinner={patchPreview.status === 'streaming'}
						spinnerTitle="Patching file"
					/>
				</div>
			) : effectiveHighlight ? (
				<div className="shrink-0 border-b border-sidebar-border bg-blue-500/10 px-3 py-1.5 text-[12px] text-blue-700 dark:text-blue-300">
					<ActivityPathStrip
						label={formatReadHighlightLabel(effectiveHighlight)}
						path={selectedFile}
						showSpinner={effectiveHighlight.status === 'streaming'}
						spinnerTitle="Reading file"
					/>
				</div>
			) : null}

			<div ref={scrollContainerRef} className="flex-1 overflow-auto">
				{isLoading ? (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						Loading file...
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
							content={activePatchPreview?.content ?? data.content}
							path={selectedFile}
							highlightedLines={
								activePatchPreview ? undefined : highlightedLines
							}
							lineTones={activePatchPreview?.lineTones}
							scrollToLine={activePatchPreview?.latestLine ?? highlightStart}
						/>
					)
				) : (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						Unable to load file
					</div>
				)}
			</div>
		</div>
	);
});
