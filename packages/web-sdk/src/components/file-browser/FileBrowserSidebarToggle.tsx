import { memo } from 'react';
import { FolderTree } from 'lucide-react';
import { useFileBrowserStore } from '../../stores/fileBrowserStore';
import { SidebarShortcutBadge } from '../sidebar/SidebarShortcutBadge';
import { Tooltip } from '../ui/Tooltip';

export const FileBrowserSidebarToggle = memo(
	function FileBrowserSidebarToggle() {
		const isExpanded = useFileBrowserStore((s) => s.isExpanded);
		const toggleSidebar = useFileBrowserStore((s) => s.toggleSidebar);

		return (
			<Tooltip content="Files" side="left">
				<button
					type="button"
					onClick={toggleSidebar}
					className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
						isExpanded
							? 'bg-muted border-primary'
							: 'border-transparent hover:bg-muted/50'
					}`}
					aria-label="Files"
				>
					<FolderTree className="size-[18px] text-muted-foreground mx-auto" />
					<SidebarShortcutBadge shortcut="3" />
				</button>
			</Tooltip>
		);
	},
);
