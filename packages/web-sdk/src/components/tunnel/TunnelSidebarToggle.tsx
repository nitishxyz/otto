import { memo } from 'react';
import { Globe } from 'lucide-react';
import { useTunnelStore } from '../../stores/tunnelStore';

export const TunnelSidebarToggle = memo(function TunnelSidebarToggle() {
	const isExpanded = useTunnelStore((state) => state.isExpanded);
	const toggleSidebar = useTunnelStore((state) => state.toggleSidebar);
	const status = useTunnelStore((state) => state.status);

	const isConnected = status === 'connected';

	return (
		<button
			type="button"
			onClick={toggleSidebar}
			className={`relative h-10 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
				isExpanded
					? 'bg-muted border-primary'
					: 'border-transparent hover:bg-muted/50'
			}`}
			title="Remote Access"
		>
			<Globe className="size-[18px] text-muted-foreground mx-auto" />
			{isConnected && (
				<span className="absolute top-1.5 right-1.5 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
			)}
		</button>
	);
});
