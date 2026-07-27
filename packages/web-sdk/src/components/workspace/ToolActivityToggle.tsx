import { Footprints } from 'lucide-react';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';

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
	const label = followToolActivity
		? 'Following read/write/patch tool activity in viewer'
		: 'Follow read/write/patch tool activity in viewer';

	return (
		<div className="flex items-center gap-0.5">
			<Tooltip content={label} side="bottom">
				<Button
					variant="ghost"
					size="icon"
					onClick={toggleFollowToolActivity}
					aria-label={label}
					aria-pressed={followToolActivity}
					className={
						compact ? 'h-7 w-7 flex-shrink-0' : 'h-7 w-7 flex-shrink-0'
					}
				>
					<Footprints
						className={`h-3.5 w-3.5 ${
							followToolActivity ? 'text-blue-600 dark:text-blue-300' : ''
						}`}
					/>
				</Button>
			</Tooltip>
		</div>
	);
}
