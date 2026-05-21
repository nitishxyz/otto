import { memo } from 'react';
import { FilePen } from 'lucide-react';
import { useSessionFilesStore } from '../../stores/sessionFilesStore';
import { useSessionFiles } from '../../hooks/useSessionFiles';
import { SidebarShortcutBadge } from '../sidebar/SidebarShortcutBadge';

interface SessionFilesSidebarToggleProps {
	sessionId?: string;
}

export const SessionFilesSidebarToggle = memo(
	function SessionFilesSidebarToggle({
		sessionId,
	}: SessionFilesSidebarToggleProps) {
		const isExpanded = useSessionFilesStore((state) => state.isExpanded);
		const toggleSidebar = useSessionFilesStore((state) => state.toggleSidebar);
		const { data } = useSessionFiles(sessionId, isExpanded);

		const fileCount = data?.totalFiles ?? 0;

		return (
			<button
				type="button"
				onClick={toggleSidebar}
				className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
					isExpanded
						? 'bg-muted border-primary'
						: 'border-transparent hover:bg-muted/50'
				}`}
				title="Session Files"
			>
				<FilePen className="size-[18px] text-muted-foreground mx-auto" />
				{fileCount > 0 && (
					<span className="absolute top-0.5 right-0.5 w-4 h-4 bg-primary text-primary-foreground text-[10px] rounded-full flex items-center justify-center font-semibold">
						{fileCount > 9 ? '9+' : fileCount}
					</span>
				)}
				<SidebarShortcutBadge shortcut="2" />
			</button>
		);
	},
);
