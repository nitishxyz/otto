import { Footprints } from 'lucide-react';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import { Button } from '../ui/Button';

interface ToolActivityToggleProps {
	compact?: boolean;
}

export function ToolActivityToggle({
	compact = false,
}: ToolActivityToggleProps) {
	const followToolActivity = useViewerTabsStore(
		(state) => state.followToolActivity,
	);
	const toggleFollowToolActivity = useViewerTabsStore(
		(state) => state.toggleFollowToolActivity,
	);

	return (
		<div className="flex items-center gap-0.5">
			<Button
				variant="ghost"
				size="icon"
				onClick={toggleFollowToolActivity}
				title={
					followToolActivity
						? 'Following read/write/patch tool activity in viewer'
						: 'Follow read/write/patch tool activity in viewer'
				}
				className={compact ? 'h-7 w-7 flex-shrink-0' : 'h-7 w-7 flex-shrink-0'}
			>
				<Footprints
					className={`h-3.5 w-3.5 ${
						followToolActivity ? 'text-blue-600 dark:text-blue-300' : ''
					}`}
				/>
			</Button>
		</div>
	);
}
