import { memo } from 'react';
import { Settings } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';

export const SettingsSidebarToggle = memo(function SettingsSidebarToggle() {
	const isExpanded = useSettingsStore((state) => state.isExpanded);
	const toggleSidebar = useSettingsStore((state) => state.toggleSidebar);

	return (
		<button
			type="button"
			onClick={toggleSidebar}
			className={`relative h-10 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
				isExpanded
					? 'bg-muted border-primary'
					: 'border-transparent hover:bg-muted/50'
			}`}
			title="Settings"
		>
			<Settings className="size-[18px] text-muted-foreground mx-auto" />
		</button>
	);
});
