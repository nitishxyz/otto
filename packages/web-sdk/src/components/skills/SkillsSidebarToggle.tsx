import { memo } from 'react';
import { Sparkles } from 'lucide-react';
import { useSkillsStore } from '../../stores/skillsStore';
import { SidebarShortcutBadge } from '../sidebar/SidebarShortcutBadge';

export const SkillsSidebarToggle = memo(function SkillsSidebarToggle() {
	const isExpanded = useSkillsStore((state) => state.isExpanded);
	const toggleSidebar = useSkillsStore((state) => state.toggleSidebar);

	return (
		<button
			type="button"
			onClick={toggleSidebar}
			className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
				isExpanded
					? 'bg-muted border-primary'
					: 'border-transparent hover:bg-muted/50'
			}`}
			title="Skills"
		>
			<Sparkles className="size-[18px] text-muted-foreground mx-auto" />
			<SidebarShortcutBadge shortcut="6" />
		</button>
	);
});
