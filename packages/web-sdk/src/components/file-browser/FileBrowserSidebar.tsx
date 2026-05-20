import { memo, useCallback } from 'react';
import {
	ChevronRight,
	ChevronDown,
	FolderOpen,
	Folder,
	FileCode,
	FolderTree,
	RefreshCw,
} from 'lucide-react';
import { useFileBrowserStore } from '../../stores/fileBrowserStore';
import { usePanelWidthStore } from '../../stores/panelWidthStore';
import { useFileTree } from '../../hooks/useFileBrowser';
import { Button } from '../ui/Button';
import { ResizeHandle } from '../ui/ResizeHandle';
import { SidebarHeader } from '../ui/SidebarHeader';

const PANEL_KEY = 'file-browser';
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;

function TreeDirectory({ dirPath }: { dirPath: string }) {
	const expandedDirs = useFileBrowserStore((s) => s.expandedDirs);
	const isExpanded = expandedDirs.has(dirPath);

	const { data, isLoading } = useFileTree(dirPath, isExpanded);

	if (!isExpanded) return null;
	if (isLoading) {
		return (
			<div className="pl-4 py-1 text-xs text-muted-foreground">Loading...</div>
		);
	}

	return (
		<div className="pl-3">
			{data?.items.map((item) => (
				<TreeItem
					key={item.path}
					name={item.name}
					path={item.path}
					type={item.type}
					gitignored={item.gitignored}
					vendor={item.vendor}
				/>
			))}
		</div>
	);
}

function TreeItem({
	name,
	path,
	type,
	gitignored,
	vendor,
}: {
	name: string;
	path: string;
	type: 'file' | 'directory';
	gitignored?: boolean;
	vendor?: boolean;
}) {
	const expandedDirs = useFileBrowserStore((s) => s.expandedDirs);
	const toggleDir = useFileBrowserStore((s) => s.toggleDir);
	const openFile = useFileBrowserStore((s) => s.openFile);
	const selectedFile = useFileBrowserStore((s) => s.selectedFile);
	const isExpanded = expandedDirs.has(path);
	const isSelected = selectedFile === path;

	const handleClick = useCallback(() => {
		if (type === 'directory') {
			toggleDir(path);
		} else {
			openFile(path);
		}
	}, [type, path, toggleDir, openFile]);

	return (
		<div>
			<button
				type="button"
				onClick={handleClick}
				className={`w-full text-left flex items-center gap-1.5 px-2 py-1 text-sm hover:bg-muted/50 rounded transition-colors ${
					isSelected ? 'bg-muted text-foreground' : 'text-foreground/80'
				} ${gitignored || vendor ? 'opacity-40' : ''}`}
			>
				{type === 'directory' ? (
					<>
						{isExpanded ? (
							<ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
						) : (
							<ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
						)}
						{isExpanded ? (
							<FolderOpen className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
						) : (
							<Folder className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
						)}
					</>
				) : (
					<>
						<span className="w-3 flex-shrink-0" />
						<FileCode className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
					</>
				)}
				<span className="truncate">{name}</span>
			</button>
			{type === 'directory' && <TreeDirectory dirPath={path} />}
		</div>
	);
}

export const FileBrowserSidebar = memo(function FileBrowserSidebar() {
	const isExpanded = useFileBrowserStore((s) => s.isExpanded);
	const collapseSidebar = useFileBrowserStore((s) => s.collapseSidebar);
	const panelWidth = usePanelWidthStore(
		(s) => s.widths[PANEL_KEY] ?? DEFAULT_WIDTH,
	);

	const { data: rootData, isLoading, refetch } = useFileTree('.');

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
					icon={<FolderTree className="size-[15px]" />}
					title="Files"
					onClose={collapseSidebar}
				/>

				<div className="flex-1 overflow-y-auto p-1">
					{isLoading ? (
						<div className="p-4 text-sm text-muted-foreground">
							Loading file tree...
						</div>
					) : !rootData || rootData.items.length === 0 ? (
						<div className="p-4 text-sm text-muted-foreground">
							No files found
						</div>
					) : (
						rootData.items.map((item) => (
							<TreeItem
								key={item.path}
								name={item.name}
								path={item.path}
								type={item.type}
								gitignored={item.gitignored}
								vendor={item.vendor}
							/>
						))
					)}
				</div>

				<div className="h-12 px-3 border-t border-border text-xs text-muted-foreground flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 min-w-0 flex-1">
						<FolderTree className="w-3 h-3 flex-shrink-0" />
						<span className="truncate">Project Files</span>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => refetch()}
						title="Refresh file tree"
						className="h-6 w-6 flex-shrink-0"
						disabled={isLoading}
					>
						<RefreshCw
							className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`}
						/>
					</Button>
				</div>
			</div>
		</div>
	);
});
