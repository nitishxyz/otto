import { memo } from 'react';
import { Plug } from 'lucide-react';
import { useMCPStore } from '../../stores/mcpStore';

export const MCPSidebarToggle = memo(function MCPSidebarToggle() {
	const isExpanded = useMCPStore((state) => state.isExpanded);
	const toggleSidebar = useMCPStore((state) => state.toggleSidebar);
	const servers = useMCPStore((state) => state.servers);

	const connectedCount = servers.filter((s) => s.connected).length;

	return (
		<button
			type="button"
			onClick={toggleSidebar}
			className={`relative h-10 w-full transition-colors touch-manipulation flex items-center justify-center border-r-2 ${
				isExpanded
					? 'bg-muted border-primary'
					: 'border-transparent hover:bg-muted/50'
			}`}
			title="MCP Servers"
		>
			<Plug className="size-[18px] text-muted-foreground mx-auto" />
			{connectedCount > 0 && (
				<span className="absolute top-1.5 right-1.5 w-2 h-2 bg-green-500 rounded-full" />
			)}
		</button>
	);
});
