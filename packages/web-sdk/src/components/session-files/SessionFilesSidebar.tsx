import { memo, useMemo } from 'react';
import { FilePen, FilePlus, FileEdit, RefreshCw } from 'lucide-react';
import { useSessionFilesStore } from '../../stores/sessionFilesStore';
import { usePanelWidthStore } from '../../stores/panelWidthStore';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import { useSessionFiles } from '../../hooks/useSessionFiles';
import { Button } from '../ui/Button';
import { ResizeHandle } from '../ui/ResizeHandle';
import { SidebarHeader } from '../ui/SidebarHeader';
import type { SessionFile, SessionFileOperation } from '../../types/api';

const PANEL_KEY = 'session-files';
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 320;
const MAX_WIDTH = 600;

interface SessionFilesSidebarProps {
	sessionId?: string;
}

function getOperationIcon(operation: string) {
	switch (operation) {
		case 'write':
			return <FilePlus className="w-3 h-3 text-green-500" />;
		case 'patch':
			return <FileEdit className="w-3 h-3 text-blue-500" />;
		default:
			return <FilePen className="w-3 h-3 text-muted-foreground" />;
	}
}

function getFileName(path: string): string {
	return path.split('/').pop() || path;
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

function countLinesFromPatch(op: SessionFileOperation): {
	additions: number;
	deletions: number;
} {
	if (op.artifact?.summary) {
		return {
			additions: op.artifact.summary.additions,
			deletions: op.artifact.summary.deletions,
		};
	}

	const patch = op.artifact?.patch || op.patch;
	if (patch) {
		let additions = 0;
		let deletions = 0;
		const lines = patch.split('\n');
		for (const line of lines) {
			if (line.startsWith('+') && !line.startsWith('+++')) {
				additions++;
			} else if (line.startsWith('-') && !line.startsWith('---')) {
				deletions++;
			}
		}
		return { additions, deletions };
	}

	if (op.content) {
		const lineCount = op.content.split('\n').length;
		return { additions: lineCount, deletions: 0 };
	}

	return { additions: 0, deletions: 0 };
}

function SessionFileItem({ file }: { file: SessionFile }) {
	const openDiff = useSessionFilesStore((state) => state.openDiff);
	const selectedFile = useSessionFilesStore((state) => state.selectedFile);
	const activeViewerTab = useViewerTabsStore((state) =>
		state.tabs.find((tab) => tab.id === state.activeTabId),
	);
	const activeViewerTabPath = getViewerTabPath(activeViewerTab);
	const isSelected =
		selectedFile === file.path || activeViewerTabPath === file.path;

	const lastOp = file.operations[file.operations.length - 1];

	const { totalAdditions, totalDeletions } = useMemo(() => {
		let additions = 0;
		let deletions = 0;
		for (const op of file.operations) {
			const stats = countLinesFromPatch(op);
			additions += stats.additions;
			deletions += stats.deletions;
		}
		return { totalAdditions: additions, totalDeletions: deletions };
	}, [file.operations]);

	const handleClick = () => {
		if (file.operations.length > 0) {
			openDiff(file.path, file.operations);
		}
	};

	return (
		<button
			type="button"
			onClick={handleClick}
			className={`w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors ${
				isSelected ? 'bg-muted' : ''
			}`}
		>
			<div className="flex items-center gap-2">
				{getOperationIcon(lastOp?.operation || 'write')}
				<div className="flex-1 min-w-0">
					<div className="text-sm font-medium truncate">
						{getFileName(file.path)}
					</div>
				</div>
				<div className="flex items-center gap-1 text-xs shrink-0">
					{file.operationCount > 1 && (
						<span className="bg-muted text-muted-foreground px-1 rounded mr-1">
							{file.operationCount}x
						</span>
					)}
					<span className="text-green-500">+{totalAdditions}</span>
					<span className="text-red-500">-{totalDeletions}</span>
				</div>
			</div>
		</button>
	);
}

export const SessionFilesSidebar = memo(function SessionFilesSidebar({
	sessionId,
}: SessionFilesSidebarProps) {
	const isExpanded = useSessionFilesStore((state) => state.isExpanded);
	const collapseSidebar = useSessionFilesStore(
		(state) => state.collapseSidebar,
	);
	const panelWidth = usePanelWidthStore(
		(s) => s.widths[PANEL_KEY] ?? DEFAULT_WIDTH,
	);
	const { data, isLoading, error, refetch } = useSessionFiles(
		sessionId,
		isExpanded,
	);

	if (!isExpanded) return null;

	return (
		<div
			className="border-l border-sidebar-border sidebar-fade-in flex h-full relative"
			style={{ width: panelWidth }}
		>
			<ResizeHandle
				panelKey={PANEL_KEY}
				side="right"
				minWidth={MIN_WIDTH}
				maxWidth={MAX_WIDTH}
				defaultWidth={DEFAULT_WIDTH}
			/>
			<div className="flex-1 flex flex-col h-full min-w-0">
				<SidebarHeader
					icon={<FilePen className="size-[15px]" />}
					title={
						<>
							Session Files
							{data && data.totalFiles > 0 && (
								<span className="ml-2 text-xs text-muted-foreground">
									({data.totalFiles})
								</span>
							)}
						</>
					}
					onClose={collapseSidebar}
				/>

				<div className="flex-1 overflow-y-auto">
					{isLoading ? (
						<div className="p-4 text-sm text-muted-foreground">
							Loading session files...
						</div>
					) : error ? (
						<div className="p-4 text-sm text-orange-500">
							{error instanceof Error ? error.message : 'Failed to load files'}
						</div>
					) : !data || data.totalFiles === 0 ? (
						<div className="p-4 text-sm text-muted-foreground">
							No files modified in this session
						</div>
					) : (
						<div className="divide-y divide-border">
							{data.files.map((file) => (
								<SessionFileItem key={file.path} file={file} />
							))}
						</div>
					)}
				</div>

				<div className="h-12 px-3 border-t border-border text-xs text-muted-foreground flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 min-w-0 flex-1">
						<FilePen className="w-3 h-3 flex-shrink-0" />
						{data && data.totalOperations > 0 ? (
							<span className="truncate">
								{data.totalFiles} file{data.totalFiles !== 1 ? 's' : ''} •{' '}
								{data.totalOperations} op{data.totalOperations !== 1 ? 's' : ''}
							</span>
						) : (
							<span className="truncate">No changes</span>
						)}
					</div>
					<div className="flex items-center gap-1 flex-shrink-0">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => refetch()}
							title="Refresh session files"
							className="h-6 w-6 transition-transform duration-200 hover:scale-110"
							disabled={isLoading}
						>
							<RefreshCw
								className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`}
							/>
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
});
