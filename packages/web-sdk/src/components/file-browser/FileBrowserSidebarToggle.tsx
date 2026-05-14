import { memo } from 'react';
import { FolderTree } from 'lucide-react';
import { useFileBrowserStore } from '../../stores/fileBrowserStore';

export const FileBrowserSidebarToggle = memo(
	function FileBrowserSidebarToggle() {
		const isExpanded = useFileBrowserStore((s) => s.isExpanded);
		const toggleSidebar = useFileBrowserStore((s) => s.toggleSidebar);

		return (
			<button
				type="button"
				onClick={toggleSidebar}
				className={`relative h-10 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
					isExpanded
						? 'bg-muted border-primary'
						: 'border-transparent hover:bg-muted/50'
				}`}
				title="Files"
			>
				<FolderTree className="size-[18px] text-muted-foreground mx-auto" />
			</button>
		);
	},
);
