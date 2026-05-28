import { memo } from 'react';
import { Globe2 } from 'lucide-react';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';

export const BrowserPanelToggle = memo(function BrowserPanelToggle() {
	const tabs = useViewerTabsStore((state) => state.tabs);
	const activeTabId = useViewerTabsStore((state) => state.activeTabId);
	const openBrowserTab = useViewerTabsStore((state) => state.openBrowserTab);
	const setActiveTab = useViewerTabsStore((state) => state.setActiveTab);
	const closeTab = useViewerTabsStore((state) => state.closeTab);
	const browserTab = tabs.find((tab) => tab.type === 'browser');
	const isActive = browserTab?.id === activeTabId;

	return (
		<button
			type="button"
			onClick={() => {
				if (isActive && browserTab) {
					closeTab(browserTab.id);
					return;
				}
				if (browserTab) {
					setActiveTab(browserTab.id);
					return;
				}
				openBrowserTab();
			}}
			className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
				isActive
					? 'bg-muted border-primary'
					: 'border-transparent hover:bg-muted/50'
			}`}
			title="Browser preview"
			aria-label="Browser preview"
		>
			<Globe2 className="size-[18px] text-muted-foreground mx-auto" />
		</button>
	);
});
