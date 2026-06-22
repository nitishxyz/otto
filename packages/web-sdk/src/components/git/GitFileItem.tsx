import {
	FileIcon,
	FilePlus,
	FileX,
	Check,
	AlertCircle,
	AlertTriangle,
	RotateCcw,
	Trash2,
} from 'lucide-react';
import type { GitFileStatus } from '../../types/api';
import {
	useStageFiles,
	useUnstageFiles,
	useRestoreFiles,
	useDeleteFiles,
} from '../../hooks/useGit';
import { useGitStore } from '../../stores/gitStore';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import { useConfirmationStore } from '../../stores/confirmationStore';
import { useState } from 'react';

interface GitFileItemProps {
	file: GitFileStatus;
	staged: boolean;
	showModifiedIndicator?: boolean;
	displayPath?: string;
	indent?: number;
}

/**
 * Smart path truncation that shows the most relevant parts
 * - For short paths: show full path
 * - For long paths: show parent directory + filename
 * Examples:
 *   "src/index.ts" -> "src/index.ts"
 *   "packages/web-sdk/src/components/git/GitFileItem.tsx" -> "../git/GitFileItem.tsx"
 *   "docs/git-implementation-rework-plan.md" -> "../git-implementation-rework-plan.md"
 */
function smartTruncatePath(path: string, maxParts = 2): string {
	const parts = path.split('/');

	// If path is short enough, show it all
	if (parts.length <= maxParts + 1) {
		return path;
	}

	// Show last N parts with ellipsis
	const truncated = parts.slice(-maxParts);
	return `../${truncated.join('/')}`;
}

function getViewerTabPath(
	tab:
		| ReturnType<typeof useViewerTabsStore.getState>['tabs'][number]
		| undefined,
): string | null {
	if (!tab) return null;
	switch (tab.type) {
		case 'git-diff':
		case 'session-file-diff':
		case 'file':
			return tab.path;
		case 'skill-file':
			return tab.file;
	}
}

export function GitFileItem({
	file,
	staged,
	showModifiedIndicator = false,
	displayPath: displayPathOverride,
	indent = 0,
}: GitFileItemProps) {
	const { openDiff } = useGitStore();
	const stageFiles = useStageFiles();
	const unstageFiles = useUnstageFiles();
	const restoreFiles = useRestoreFiles();
	const deleteFiles = useDeleteFiles();
	const openConfirmation = useConfirmationStore(
		(state) => state.openConfirmation,
	);
	const activeViewerTab = useViewerTabsStore((state) =>
		state.activeTabId ? state.tabsById[state.activeTabId] : undefined,
	);
	const [isChecked, setIsChecked] = useState(staged);
	const activeViewerTabPath = getViewerTabPath(activeViewerTab);
	const isActiveViewerFile =
		activeViewerTabPath === file.path &&
		(activeViewerTab?.type !== 'git-diff' || activeViewerTab.staged === staged);

	const handleCheckChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		e.stopPropagation();
		const checked = e.target.checked;
		setIsChecked(checked);

		try {
			if (checked) {
				await stageFiles.mutateAsync([file.path]);
			} else {
				await unstageFiles.mutateAsync([file.path]);
			}
		} catch (error) {
			// Revert on error
			setIsChecked(!checked);
			console.error('Failed to stage/unstage file:', error);
		}
	};

	const handleRestore = async (e: React.MouseEvent) => {
		e.stopPropagation();
		openConfirmation({
			title: 'Restore File',
			message: `Restore ${file.path} to HEAD state? This will discard all changes.`,
			confirmLabel: 'Restore',
			variant: 'destructive',
			onConfirm: async () => {
				try {
					await restoreFiles.mutateAsync([file.path]);
				} catch (error) {
					console.error('Failed to restore file:', error);
					throw error;
				}
			},
		});
	};

	const handleDelete = async (e: React.MouseEvent) => {
		e.stopPropagation();
		openConfirmation({
			title: 'Delete File',
			message: `Delete ${file.path}? This will permanently remove the untracked file.`,
			confirmLabel: 'Delete',
			variant: 'destructive',
			onConfirm: async () => {
				try {
					await deleteFiles.mutateAsync([file.path]);
				} catch (error) {
					console.error('Failed to delete file:', error);
					throw error;
				}
			},
		});
	};

	const handleClick = () => {
		openDiff(file.path, staged);
	};

	// Status colors and icons
	const getStatusConfig = () => {
		switch (file.status) {
			case 'added':
			case 'untracked':
				return {
					icon: FilePlus,
					color: 'text-green-500',
					label: 'A',
					labelColor: 'text-green-500',
				};
			case 'deleted':
				return {
					icon: FileX,
					color: 'text-red-500',
					label: 'D',
					labelColor: 'text-red-500',
				};
			case 'modified':
				return {
					icon: FileIcon,
					color: 'text-blue-500',
					label: 'M',
					labelColor: 'text-blue-500',
				};
			case 'renamed':
				return {
					icon: FileIcon,
					color: 'text-purple-500',
					label: 'R',
					labelColor: 'text-purple-500',
				};
			case 'conflicted':
				return {
					icon: AlertTriangle,
					color: 'text-red-500',
					label: 'C',
					labelColor: 'text-red-500',
				};
			default:
				return {
					icon: FileIcon,
					color: 'text-muted-foreground',
					label: '?',
					labelColor: 'text-muted-foreground',
				};
		}
	};

	const config = getStatusConfig();
	const Icon = config.icon;

	// Smart truncation: show enough context without wrapping
	const displayPath = displayPathOverride ?? smartTruncatePath(file.path, 2);

	return (
		<button
			type="button"
			className={`flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer group transition-colors w-full text-left h-9 ${
				isActiveViewerFile ? 'bg-primary/10 text-foreground' : ''
			}`}
			onClick={handleClick}
		>
			{indent > 0 && (
				<span style={{ width: indent }} className="flex-shrink-0" />
			)}
			<input
				type="checkbox"
				checked={isChecked}
				onChange={handleCheckChange}
				onClick={(e) => e.stopPropagation()}
				className="w-4 h-4 rounded border-border"
				aria-label={`${isChecked ? 'Unstage' : 'Stage'} ${file.path}`}
			/>

			<div className="flex items-center gap-2 flex-1 min-w-0">
				<Icon className={`w-4 h-4 flex-shrink-0 ${config.color}`} />
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span
							className="text-sm text-foreground font-mono truncate"
							title={`${file.path}\n${file.absPath}`}
						>
							{displayPath}
						</span>
						<div className="flex items-center gap-1 flex-shrink-0">
							<span className={`text-xs font-semibold ${config.labelColor}`}>
								{config.label}
							</span>
							{showModifiedIndicator && (
								<div title="Also modified in working directory">
									<AlertCircle className="w-3.5 h-3.5 text-orange-500" />
								</div>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Stats */}
			{file.insertions !== undefined || file.deletions !== undefined ? (
				<div className="flex items-center gap-2 text-xs flex-shrink-0">
					{file.insertions !== undefined && file.insertions > 0 && (
						<span className="text-green-500">+{file.insertions}</span>
					)}
					{file.deletions !== undefined && file.deletions > 0 && (
						<span className="text-red-500">-{file.deletions}</span>
					)}
				</div>
			) : null}

			{/* Delete button for untracked files */}
			<div className="w-7 flex items-center justify-center flex-shrink-0">
				{!staged && file.status === 'untracked' && (
					<button
						type="button"
						onClick={handleDelete}
						className="p-1 hover:bg-destructive/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
						title="Delete untracked file"
						aria-label={`Delete ${file.path}`}
					>
						<Trash2 className="w-4 h-4 text-destructive" />
					</button>
				)}
				{!staged && file.status !== 'untracked' && file.status !== 'added' && (
					<button
						type="button"
						onClick={handleRestore}
						className="p-1 hover:bg-destructive/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
						title="Restore file to HEAD (Shift+R)"
						aria-label={`Restore ${file.path}`}
					>
						<RotateCcw className="w-4 h-4 text-destructive" />
					</button>
				)}
				{staged && !showModifiedIndicator && (
					<Check className="w-4 h-4 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
				)}
			</div>
		</button>
	);
}
