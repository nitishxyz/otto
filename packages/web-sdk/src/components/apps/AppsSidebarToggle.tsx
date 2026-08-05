import { memo } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useAppsStore } from '../../stores/appsStore';
import { Tooltip } from '../ui/Tooltip';

export const AppsSidebarToggle = memo(function AppsSidebarToggle() {
	const isExpanded = useAppsStore((state) => state.isExpanded);
	const toggleSidebar = useAppsStore((state) => state.toggleSidebar);

	return (
		<Tooltip content="Apps" side="left">
			<button
				type="button"
				onClick={toggleSidebar}
				className={`relative flex h-12 w-full touch-manipulation items-center justify-center border-r-2 transition-colors ${
					isExpanded
						? 'border-primary bg-muted'
						: 'border-transparent hover:bg-muted/50'
				}`}
				aria-label="Apps"
			>
				<LayoutGrid className="mx-auto size-[18px] text-muted-foreground" />
			</button>
		</Tooltip>
	);
});
