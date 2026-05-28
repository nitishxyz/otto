import { useEffect, memo, useState } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { useGitStore } from '../../stores/gitStore';
import { useGitDiff } from '../../hooks/useGit';
import { useGitDiffFullFile } from '../../hooks/useFileBrowser';
import { Button } from '../ui/Button';
import { GitDiffViewer } from './GitDiffViewer';
import { ViewerStatusBar } from '../workspace/ViewerStatusBar';

interface GitDiffPanelProps {
	mode?: 'overlay' | 'pane';
	open?: boolean;
	file?: string | null;
	staged?: boolean;
	onClose?: () => void;
}

export const GitDiffPanel = memo(function GitDiffPanel({
	mode = 'overlay',
	open,
	file,
	staged,
	onClose,
}: GitDiffPanelProps = {}) {
	// Use selectors to only subscribe to needed state
	const storeIsDiffOpen = useGitStore((state) => state.isDiffOpen);
	const storeSelectedFile = useGitStore((state) => state.selectedFile);
	const storeSelectedFileStaged = useGitStore(
		(state) => state.selectedFileStaged,
	);
	const storeCloseDiff = useGitStore((state) => state.closeDiff);
	const isDiffOpen = open ?? storeIsDiffOpen;
	const selectedFile = file ?? storeSelectedFile;
	const selectedFileStaged = staged ?? storeSelectedFileStaged;
	const closeDiff = onClose ?? storeCloseDiff;

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
					? 'relative h-full w-full bg-transparent flex flex-col'
					: 'absolute inset-0 bg-background z-50 flex flex-col animate-in slide-in-from-left duration-300'
			}
		>
			{mode !== 'pane' && (
				<div className="h-12 border-b border-sidebar-border px-2.5 flex items-center gap-2 shrink-0 bg-sidebar-accent/40">
					<Button
						variant="ghost"
						size="icon"
						onClick={closeDiff}
						title="Close diff viewer (ESC)"
						className="h-8 w-8"
					>
						<X className="size-[17px]" />
					</Button>
					<div className="flex-1 flex items-center gap-2 min-w-0">
						<span
							className="text-[13px] font-medium text-foreground font-mono truncate"
							title={`${selectedFile}\n${activeDiff?.absPath || ''}`}
						>
							{selectedFile}
						</span>
						{selectedFileStaged && (
							<span className="text-[12px] px-1.5 py-0.5 rounded bg-primary/10 text-primary flex-shrink-0">
								Staged
							</span>
						)}
					</div>
					<Button
						variant={showFullFile ? 'secondary' : 'ghost'}
						size="sm"
						onClick={() => setShowFullFile((v) => !v)}
						title={
							showFullFile
								? 'Show diff only (f)'
								: 'Show full file with diff (f)'
						}
						className="flex items-center gap-1.5 text-[13px] h-8 px-2.5"
					>
						{showFullFile ? (
							<Minimize2 className="w-3.5 h-3.5" />
						) : (
							<Maximize2 className="w-3.5 h-3.5" />
						)}
						{showFullFile ? 'Diff' : 'Full File'}
					</Button>
				</div>
			)}
			{mode === 'pane' && (
				<Button
					variant={showFullFile ? 'secondary' : 'ghost'}
					size="sm"
					onClick={() => setShowFullFile((v) => !v)}
					title={
						showFullFile ? 'Show diff only (f)' : 'Show full file with diff (f)'
					}
					className="absolute right-3 top-3 z-20 h-8 gap-1.5 border border-border/70 bg-background/85 px-2.5 text-[12px] shadow-sm backdrop-blur hover:bg-muted"
				>
					{showFullFile ? (
						<Minimize2 className="w-3.5 h-3.5" />
					) : (
						<Maximize2 className="w-3.5 h-3.5" />
					)}
					{showFullFile ? 'Diff' : 'Full file'}
				</Button>
			)}

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
			<ViewerStatusBar
				tone={selectedFileStaged ? 'success' : 'patch'}
				label={
					activeDiff?.isNewFile
						? 'New file'
						: selectedFileStaged
							? 'Staged diff'
							: 'Working diff'
				}
				path={selectedFile}
				changeCount={
					activeDiff && (activeDiff.insertions > 0 || activeDiff.deletions > 0)
						? {
								additions: activeDiff.insertions,
								removals: activeDiff.deletions,
							}
						: undefined
				}
			/>
		</div>
	);
});
