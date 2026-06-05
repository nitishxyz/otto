import { memo } from 'react';
import { Bot } from 'lucide-react';
import { useAgentsStore } from '../../stores/agentsStore';

export const AgentsSidebarToggle = memo(function AgentsSidebarToggle() {
	const isExpanded = useAgentsStore((state) => state.isExpanded);
	const toggleManager = useAgentsStore((state) => state.toggleManager);

	return (
		<button
			type="button"
			onClick={toggleManager}
			className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
				isExpanded
					? 'bg-muted border-primary'
					: 'border-transparent hover:bg-muted/50'
			}`}
			title="Agents"
		>
			<Bot className="size-[18px] text-muted-foreground mx-auto" />
		</button>
	);
});
