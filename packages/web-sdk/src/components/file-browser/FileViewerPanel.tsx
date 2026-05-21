import { memo, useEffect, type ComponentPropsWithoutRef } from 'react';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
	prism,
	vscDarkPlus,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { useFileBrowserStore } from '../../stores/fileBrowserStore';
import { useFileContent } from '../../hooks/useFileBrowser';
import { Button } from '../ui/Button';

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

interface FileViewerPanelProps {
	mode?: 'overlay' | 'pane';
	open?: boolean;
	file?: string | null;
	onClose?: () => void;
}

export const FileViewerPanel = memo(function FileViewerPanel({
	mode = 'overlay',
	open,
	file,
	onClose,
}: FileViewerPanelProps = {}) {
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

	if (!isViewerOpen || !selectedFile) return null;

	const syntaxTheme = document?.documentElement.classList.contains('dark')
		? vscDarkPlus
		: prism;
	const language = inferLanguage(selectedFile);
	const renderMarkdown = isMarkdownFile(selectedFile);

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

			<div className="flex-1 overflow-auto">
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
						<div className="code-with-line-numbers">
							<SyntaxHighlighter
								language={language}
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
									fontSize: '0.8125rem',
									lineHeight: '1.3125rem',
								}}
								codeTagProps={{
									style: {
										flex: 1,
									},
								}}
							>
								{data.content}
							</SyntaxHighlighter>
						</div>
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
