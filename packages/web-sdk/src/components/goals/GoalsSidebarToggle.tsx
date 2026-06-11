import { memo } from 'react';
import { Target } from 'lucide-react';
import { useGoalsPanelStore } from '../../stores/goalsPanelStore';
import { useOttoEnabled, useSessionGoal } from '../../hooks/useGoals';

interface GoalsSidebarToggleProps {
	sessionId?: string;
}

export const GoalsSidebarToggle = memo(function GoalsSidebarToggle({
	sessionId,
}: GoalsSidebarToggleProps) {
	const isExpanded = useGoalsPanelStore((state) => state.isExpanded);
	const toggleSidebar = useGoalsPanelStore((state) => state.toggleSidebar);
	const ottoEnabled = useOttoEnabled();
	const { data } = useSessionGoal(sessionId);

	if (!ottoEnabled) return null;

	const tasks = data?.goal?.tasks ?? [];
	const openCount = tasks.filter(
		(task) => task.status !== 'completed' && task.status !== 'cancelled',
	).length;

	return (
		<button
			type="button"
			onClick={toggleSidebar}
			className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
				isExpanded
					? 'bg-muted border-primary'
					: 'border-transparent hover:bg-muted/50'
			}`}
			title="Goals"
		>
			<Target className="size-[18px] text-muted-foreground mx-auto" />
			{openCount > 0 && (
				<span className="absolute top-0.5 right-0.5 w-4 h-4 bg-primary text-primary-foreground text-[10px] rounded-full flex items-center justify-center font-semibold">
					{openCount > 9 ? '9+' : openCount}
				</span>
			)}
		</button>
	);
});
