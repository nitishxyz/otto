import { memo } from 'react';
import { Network } from 'lucide-react';
import { useTunnelStore } from '../../stores/tunnelStore';
import { isShareMode } from '../../lib/share-mode';
import { SidebarShortcutBadge } from '../sidebar/SidebarShortcutBadge';

export const TunnelSidebarToggle = memo(function TunnelSidebarToggle() {
	const isExpanded = useTunnelStore((state) => state.isExpanded);
	const toggleSidebar = useTunnelStore((state) => state.toggleSidebar);
	const managedStatus = useTunnelStore((state) => state.remoteManaged.status);
	const quickStatus = useTunnelStore((state) => state.remoteQuick.status);
	const shareStatus = useTunnelStore((state) => state.projectShare.status);

	// Connections are owner-only; share viewers never see the toggle.
	if (isShareMode()) return null;

	const isConnected =
		managedStatus === 'connected' ||
		quickStatus === 'connected' ||
		shareStatus === 'connected';

	return (
		<button
			type="button"
			onClick={toggleSidebar}
			className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
				isExpanded
					? 'bg-muted border-primary'
					: 'border-transparent hover:bg-muted/50'
			}`}
			title="Connections"
		>
			<Network className="size-[18px] text-muted-foreground mx-auto" />
			{isConnected && (
				<span className="absolute top-1.5 right-1.5 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
			)}
			<SidebarShortcutBadge shortcut="4" />
		</button>
	);
});
