import { memo } from 'react';
import { Repeat2, ShipWheel } from 'lucide-react';

export type WorkspaceTab = 'agents' | 'looper';

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
	{ id: 'agents', label: 'agents' },
	{ id: 'looper', label: 'looper' },
];

interface LooperTabBarProps {
	activeTab: WorkspaceTab;
	onTabChange: (tab: WorkspaceTab) => void;
	/**
	 * 'sidebar' (default): full-width tab row for the left sidebar.
	 * 'titlebar': compact segmented control for the top title bar.
	 */
	variant?: 'sidebar' | 'titlebar';
}

/**
 * Top-level workspace tab switcher: Chats (direct sessions) vs Looper (goal
 * orchestrator). Controlled by the host app — typically backed by routes
 * (/sessions vs /looper) so refreshes land on the same tab.
 */
export const LooperTabBar = memo(function LooperTabBar({
	activeTab,
	onTabChange,
	variant = 'sidebar',
}: LooperTabBarProps) {
	if (variant === 'titlebar') {
		return (
			<div className="flex h-8 items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
				{TABS.map((tab) => {
					const isActive = activeTab === tab.id;
					return (
						<button
							key={tab.id}
							type="button"
							onClick={() => onTabChange(tab.id)}
							className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors touch-manipulation ${
								isActive
									? 'bg-background text-foreground shadow-sm'
									: 'text-muted-foreground hover:text-foreground'
							}`}
							aria-pressed={isActive}
						>
							{tab.id === 'agents' ? (
								<ShipWheel className="h-3.5 w-3.5" />
							) : (
								<Repeat2 className="h-3.5 w-3.5" />
							)}
							{tab.label}
						</button>
					);
				})}
			</div>
		);
	}
	return (
		<div className="flex h-10 shrink-0 items-stretch gap-1 border-b border-sidebar-border px-2 pt-1.5 pb-1">
			{TABS.map((tab) => {
				const isActive = activeTab === tab.id;
				return (
					<button
						key={tab.id}
						type="button"
						onClick={() => onTabChange(tab.id)}
						className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium transition-colors touch-manipulation ${
							isActive
								? 'bg-sidebar-accent text-sidebar-foreground'
								: 'text-sidebar-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
						}`}
						aria-pressed={isActive}
					>
						{tab.id === 'agents' ? (
							<ShipWheel className="h-3.5 w-3.5" />
						) : (
							<Repeat2 className="h-3.5 w-3.5" />
						)}
						{tab.label}
					</button>
				);
			})}
		</div>
	);
});
