import { memo } from 'react';
import { GitBranch } from 'lucide-react';
import { useGitStore } from '../../stores/gitStore';
import { useGitStatus } from '../../hooks/useGit';
import { SidebarShortcutBadge } from '../sidebar/SidebarShortcutBadge';

export const GitSidebarToggle = memo(function GitSidebarToggle() {
	// Use selectors to only subscribe to needed state
	const isExpanded = useGitStore((state) => state.isExpanded);
	const toggleSidebar = useGitStore((state) => state.toggleSidebar);
	const { data: status } = useGitStatus();

	const totalChanges =
		(status?.staged?.length ?? 0) +
		(status?.unstaged?.length ?? 0) +
		(status?.untracked?.length ?? 0);

	return (
		<button
			type="button"
			onClick={toggleSidebar}
			className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
				isExpanded
					? 'bg-muted border-primary'
					: 'border-transparent hover:bg-muted/50'
			}`}
			title="Git"
		>
			<GitBranch className="size-[18px] text-muted-foreground mx-auto" />
			{totalChanges > 0 && (
				<span className="absolute top-0.5 right-0.5 w-4 h-4 bg-primary text-primary-foreground text-[10px] rounded-full flex items-center justify-center font-semibold">
					{totalChanges > 9 ? '9+' : totalChanges}
				</span>
			)}
			<SidebarShortcutBadge shortcut="1" />
		</button>
	);
});
