import { memo } from 'react';
import { FlaskConical } from 'lucide-react';
import { useResearchStore } from '../../stores/researchStore';
import { useResearchSessions } from '../../hooks/useResearch';

interface ResearchSidebarToggleProps {
	parentSessionId?: string;
}

export const ResearchSidebarToggle = memo(function ResearchSidebarToggle({
	parentSessionId,
}: ResearchSidebarToggleProps) {
	const isExpanded = useResearchStore((state) => state.isExpanded);
	const toggleSidebar = useResearchStore((state) => state.toggleSidebar);
	const { data } = useResearchSessions(parentSessionId ?? null);

	const sessionCount = data?.sessions?.length ?? 0;

	return (
		<button
			type="button"
			onClick={toggleSidebar}
			className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
				isExpanded
					? 'bg-muted border-primary'
					: 'border-transparent hover:bg-muted/50'
			}`}
			title="Research (⌘⇧R)"
		>
			<FlaskConical className="size-[18px] text-muted-foreground mx-auto" />
			{sessionCount > 0 && (
				<span className="absolute top-0.5 right-0.5 w-4 h-4 bg-primary text-primary-foreground text-[10px] rounded-full flex items-center justify-center font-semibold">
					{sessionCount > 9 ? '9+' : sessionCount}
				</span>
			)}
		</button>
	);
});
