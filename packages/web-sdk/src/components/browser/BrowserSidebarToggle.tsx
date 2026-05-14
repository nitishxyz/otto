import { memo } from 'react';
import { Monitor } from 'lucide-react';
import { useBrowserPanelStore } from '../../stores/browserPanelStore';

export const BrowserSidebarToggle = memo(function BrowserSidebarToggle() {
	const isExpanded = useBrowserPanelStore((state) => state.isExpanded);
	const toggleSidebar = useBrowserPanelStore((state) => state.toggleSidebar);
	const tabCount = useBrowserPanelStore((state) => state.tabs.length);

	return (
		<button
			type="button"
			onClick={toggleSidebar}
			className={`relative h-10 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
				isExpanded
					? 'bg-muted border-primary'
					: 'border-transparent hover:bg-muted/50'
			}`}
			title="Browser"
		>
			<Monitor className="size-[18px] text-muted-foreground mx-auto" />
			{tabCount > 0 && (
				<span className="absolute top-1 right-1 min-w-5 h-5 px-1 bg-primary text-primary-foreground text-[10px] rounded-full flex items-center justify-center font-semibold">
					{tabCount}
				</span>
			)}
		</button>
	);
});
