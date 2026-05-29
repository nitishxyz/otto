import { GitCommit, CheckSquare, AlertTriangle } from 'lucide-react';
import type { GitStatusResponse } from '../../types/api';
import { Button } from '../ui/Button';
import { GitFileTree } from './GitFileTree';
import { useGitStore } from '../../stores/gitStore';
import { useStageFiles, useUnstageFiles } from '../../hooks/useGit';
import { useCallback, useMemo } from 'react';

interface GitFileListProps {
	status: GitStatusResponse;
}

export function GitFileList({ status }: GitFileListProps) {
	const { openCommitModal } = useGitStore();
	const stageFiles = useStageFiles();
	const unstageFiles = useUnstageFiles();

	const hasConflicts = (status.conflicted?.length ?? 0) > 0;
	const hasStaged = status.staged.length > 0;
	const hasUnstaged = status.unstaged.length > 0 || status.untracked.length > 0;

	const unstagedFiles = useMemo(
		() => [...status.unstaged, ...status.untracked],
		[status.unstaged, status.untracked],
	);
	const hasUnstagedFiles = unstagedFiles.length > 0;

	const unstagedPaths = useMemo(
		() => new Set(status.unstaged.map((f) => f.path)),
		[status.unstaged],
	);

	const handleStagePaths = useCallback(
		(paths: string[]) => stageFiles.mutate(paths),
		[stageFiles],
	);

	const handleUnstagePaths = useCallback(
		(paths: string[]) => unstageFiles.mutate(paths),
		[unstageFiles],
	);

	const showStagedModifiedIndicator = useCallback(
		(file: { path: string }) => unstagedPaths.has(file.path),
		[unstagedPaths],
	);

	const handleStageAll = () => {
		if (hasUnstagedFiles) {
			stageFiles.mutate(['.']);
		}
	};

	const conflictedLength = status.conflicted?.length ?? 0;

	return (
		<div className="flex flex-col">
			{hasConflicts && (
				<div className="border-b border-border">
					<div className="px-3 py-2 bg-red-500/10 flex items-center justify-between">
						<span className="text-xs font-semibold text-red-500 uppercase flex items-center gap-1.5">
							<AlertTriangle className="w-3.5 h-3.5" />
							Conflicts ({conflictedLength})
						</span>
					</div>
					<div>
						<GitFileTree
							sectionId="conflicts"
							files={status.conflicted ?? []}
							staged={false}
							onToggleFolder={handleStagePaths}
						/>
					</div>
				</div>
			)}

			{hasStaged && (
				<div className={hasUnstaged ? 'border-b border-border' : undefined}>
					<div className="px-3 py-2 bg-muted/50 flex items-center justify-between">
						<span className="text-xs font-semibold text-foreground uppercase">
							Staged Changes ({status.staged.length})
						</span>
						<div className="flex items-center gap-1">
							{status.staged.length > 0 && !hasConflicts && (
								<Button
									variant="primary"
									size="sm"
									onClick={openCommitModal}
									className="h-6 text-xs"
								>
									<GitCommit className="w-3 h-3 mr-1" />
									Commit
								</Button>
							)}
							{status.staged.length > 0 && hasConflicts && (
								<span className="text-xs text-muted-foreground">
									Resolve conflicts first
								</span>
							)}
						</div>
					</div>
					<div>
						<GitFileTree
							sectionId="staged"
							files={status.staged}
							staged={true}
							onToggleFolder={handleUnstagePaths}
							showModifiedIndicator={showStagedModifiedIndicator}
						/>
					</div>
				</div>
			)}

			{hasUnstaged && (
				<div>
					<div className="px-3 py-2 bg-muted/50 flex items-center justify-between">
						<span className="text-xs font-semibold text-foreground uppercase">
							Changes ({status.unstaged.length + status.untracked.length})
						</span>
						{hasUnstagedFiles && (
							<Button
								variant="ghost"
								size="sm"
								onClick={handleStageAll}
								title="Stage all changes"
								className="h-6 text-xs"
							>
								<CheckSquare className="w-3 h-3 mr-1" />
								Stage All
							</Button>
						)}
					</div>
					<div>
						<GitFileTree
							sectionId="changes"
							files={unstagedFiles}
							staged={false}
							onToggleFolder={handleStagePaths}
						/>
					</div>
				</div>
			)}

			{!hasConflicts && !hasStaged && !hasUnstaged && (
				<div className="p-4 text-sm text-muted-foreground text-center">
					No changes
				</div>
			)}
		</div>
	);
}
