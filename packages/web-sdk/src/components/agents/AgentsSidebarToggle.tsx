import { memo } from 'react';
import { Bot } from 'lucide-react';
import { useAgentsStore } from '../../stores/agentsStore';
import { SidebarShortcutBadge } from '../sidebar/SidebarShortcutBadge';
import { Tooltip } from '../ui/Tooltip';

export const AgentsSidebarToggle = memo(function AgentsSidebarToggle() {
	const isExpanded = useAgentsStore((state) => state.isExpanded);
	const toggleManager = useAgentsStore((state) => state.toggleManager);

	return (
		<Tooltip content="Agents" side="left">
			<button
				type="button"
				onClick={toggleManager}
				className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
					isExpanded
						? 'bg-muted border-primary'
						: 'border-transparent hover:bg-muted/50'
				}`}
				aria-label="Agents"
			>
				<Bot className="size-[18px] text-muted-foreground mx-auto" />
				<SidebarShortcutBadge shortcut="8" />
			</button>
		</Tooltip>
	);
});
