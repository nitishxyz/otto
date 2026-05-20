import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface SidebarHeaderProps {
	icon: ReactNode;
	title: ReactNode;
	onClose: () => void;
	children?: ReactNode;
	closeTitle?: string;
}

export function SidebarHeader({
	icon,
	title,
	onClose,
	children,
	closeTitle = 'Close sidebar',
}: SidebarHeaderProps) {
	return (
		<div className="h-12 border-b border-sidebar-border px-2.5 flex items-center gap-2 shrink-0 bg-sidebar">
			<div className="flex items-center gap-2 min-w-0 shrink-0 pr-1">
				<span className="text-muted-foreground shrink-0">{icon}</span>
				<span className="text-sm font-medium text-foreground truncate">
					{title}
				</span>
			</div>
			{children && (
				<div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
			)}
			<button
				type="button"
				onClick={onClose}
				className="ml-auto h-8 w-8 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
				title={closeTitle}
			>
				<ChevronRight className="size-[17px]" />
			</button>
		</div>
	);
}
