import { memo } from 'react';
import { Globe2 } from 'lucide-react';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import { SidebarShortcutBadge } from '../sidebar/SidebarShortcutBadge';
import { Tooltip } from '../ui/Tooltip';

export const BrowserPanelToggle = memo(function BrowserPanelToggle() {
	const browserTab = useViewerTabsStore((state) =>
		state.tabOrder
			.map((id) => state.tabsById[id])
			.find((tab) => tab?.type === 'browser'),
	);
	const activeTabId = useViewerTabsStore((state) => state.activeTabId);
	const openBrowserTab = useViewerTabsStore((state) => state.openBrowserTab);
	const setActiveTab = useViewerTabsStore((state) => state.setActiveTab);
	const closeTab = useViewerTabsStore((state) => state.closeTab);
	const isActive = browserTab?.id === activeTabId;

	return (
		<Tooltip content="Browser preview" side="left">
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
				aria-label="Browser preview"
			>
				<Globe2 className="size-[18px] text-muted-foreground mx-auto" />
				<SidebarShortcutBadge shortcut="4" />
			</button>
		</Tooltip>
	);
});
