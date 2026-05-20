import { useEffect, memo, useState } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { useGitStore } from '../../stores/gitStore';
import { useGitDiff } from '../../hooks/useGit';
import { useGitDiffFullFile } from '../../hooks/useFileBrowser';
import { Button } from '../ui/Button';
import { GitDiffViewer } from './GitDiffViewer';

interface GitDiffPanelProps {
	mode?: 'overlay' | 'pane';
}

export const GitDiffPanel = memo(function GitDiffPanel({
	mode = 'overlay',
}: GitDiffPanelProps = {}) {
	// Use selectors to only subscribe to needed state
	const isDiffOpen = useGitStore((state) => state.isDiffOpen);
	const selectedFile = useGitStore((state) => state.selectedFile);
	const selectedFileStaged = useGitStore((state) => state.selectedFileStaged);
	const closeDiff = useGitStore((state) => state.closeDiff);

	const { data: diff, isLoading } = useGitDiff(
		selectedFile,
		selectedFileStaged,
	);

	const [showFullFile, setShowFullFile] = useState(false);
	const { data: fullFileDiff, isLoading: fullFileLoading } = useGitDiffFullFile(
		selectedFile,
		selectedFileStaged,
		showFullFile,
	);

	const activeDiff = showFullFile && fullFileDiff ? fullFileDiff : diff;
	const activeLoading = showFullFile ? fullFileLoading : isLoading;

	useEffect(() => {
		if (!isDiffOpen) setShowFullFile(false);
	}, [isDiffOpen]);

	// Handle ESC key
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const isInInput =
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable;
			if ((e.key === 'Escape' || (e.key === 'q' && !isInInput)) && isDiffOpen) {
				closeDiff();
			}
			if (e.key === 'f' && !isInInput && isDiffOpen) {
				setShowFullFile((v) => !v);
			}
		};

		document.addEventListener('keydown', handleEscape);
		return () => document.removeEventListener('keydown', handleEscape);
	}, [isDiffOpen, closeDiff]);

	if (!isDiffOpen || !selectedFile) return null;

	return (
		<div
			className={
				mode === 'pane'
					? 'h-full w-full bg-transparent flex flex-col'
					: 'absolute inset-0 bg-background z-50 flex flex-col animate-in slide-in-from-left duration-300'
			}
		>
			{/* Header - Full path display */}
			<div className="h-10 border-b border-sidebar-border px-2 flex items-center gap-1.5 shrink-0 bg-sidebar-accent/40">
				<Button
					variant="ghost"
					size="icon"
					onClick={closeDiff}
					title="Close diff viewer (ESC)"
					className="h-7 w-7"
				>
					<X className="size-[15px]" />
				</Button>
				<div className="flex-1 flex items-center gap-2 min-w-0">
					<span
						className="text-[11px] font-medium text-foreground font-mono truncate"
						title={`${selectedFile}\n${activeDiff?.absPath || ''}`}
					>
						{selectedFile}
					</span>
					{selectedFileStaged && (
						<span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary flex-shrink-0">
							Staged
						</span>
					)}
				</div>
				<Button
					variant={showFullFile ? 'secondary' : 'ghost'}
					size="sm"
					onClick={() => setShowFullFile((v) => !v)}
					title={
						showFullFile ? 'Show diff only (f)' : 'Show full file with diff (f)'
					}
					className="flex items-center gap-1.5 text-[11px] h-7 px-2"
				>
					{showFullFile ? (
						<Minimize2 className="w-3.5 h-3.5" />
					) : (
						<Maximize2 className="w-3.5 h-3.5" />
					)}
					{showFullFile ? 'Diff' : 'Full File'}
				</Button>
			</div>

			<div className="flex-1 overflow-auto">
				{activeLoading ? (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						Loading diff...
					</div>
				) : activeDiff ? (
					<GitDiffViewer diff={activeDiff} />
				) : (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						No diff available
					</div>
				)}
			</div>
		</div>
	);
});
