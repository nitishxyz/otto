import { memo, useEffect } from 'react';
import { X } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
	prism,
	vscDarkPlus,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useSkillsStore } from '../../stores/skillsStore';
import { useSkillDetail, useSkillFileContent } from '../../hooks/useSkills';
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
	txt: 'plaintext',
	toml: 'toml',
};

function inferLanguage(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	return LANGUAGE_MAP[ext] ?? 'plaintext';
}

interface SkillViewerPanelProps {
	mode?: 'overlay' | 'pane';
}

export const SkillViewerPanel = memo(function SkillViewerPanel({
	mode = 'overlay',
}: SkillViewerPanelProps = {}) {
	const isViewerOpen = useSkillsStore((s) => s.isViewerOpen);
	const viewingFile = useSkillsStore((s) => s.viewingFile);
	const selectedSkill = useSkillsStore((s) => s.selectedSkill);
	const closeViewer = useSkillsStore((s) => s.closeViewer);

	const { data: skillDetail } = useSkillDetail(selectedSkill);
	const { data: fileData, isLoading: fileLoading } = useSkillFileContent(
		selectedSkill,
		viewingFile,
	);

	const isMainFile = viewingFile === null;
	const content = isMainFile ? skillDetail?.content : fileData?.content;
	const isLoading = isMainFile ? !skillDetail : fileLoading;
	const displayPath = isMainFile ? 'SKILL.md' : (viewingFile ?? '');
	const language = inferLanguage(displayPath);

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

	if (!isViewerOpen || !selectedSkill) return null;

	const syntaxTheme = document?.documentElement.classList.contains('dark')
		? vscDarkPlus
		: prism;

	return (
		<div
			className={
				mode === 'pane'
					? 'h-full w-full bg-transparent flex flex-col'
					: 'absolute inset-0 bg-background z-50 flex flex-col animate-in slide-in-from-left duration-300'
			}
		>
			<div className="h-10 border-b border-sidebar-border px-2 flex items-center gap-1.5 shrink-0 bg-sidebar-accent/40">
				<Button
					variant="ghost"
					size="icon"
					onClick={closeViewer}
					title="Close viewer (ESC)"
					className="h-7 w-7"
				>
					<X className="size-[15px]" />
				</Button>
				<div className="flex-1 flex items-center gap-2 min-w-0">
					<span className="text-[11px] text-muted-foreground flex-shrink-0">
						{selectedSkill}
					</span>
					<span className="text-[11px] text-muted-foreground">/</span>
					<span
						className="text-[11px] font-medium text-foreground font-mono truncate"
						title={displayPath}
					>
						{displayPath}
					</span>
				</div>
				<span className="text-[10px] text-muted-foreground pr-1">
					{language}
				</span>
			</div>

			<div className="flex-1 overflow-auto">
				{isLoading ? (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						Loading...
					</div>
				) : content ? (
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
								fontSize: '0.75rem',
								lineHeight: '1.25rem',
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
				) : (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						Unable to load file
					</div>
				)}
			</div>
		</div>
	);
});
