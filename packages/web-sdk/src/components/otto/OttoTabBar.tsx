import { memo } from 'react';
import { Bot, Target } from 'lucide-react';
import { useOttoEnabled } from '../../hooks/useGoals';

export type WorkspaceTab = 'agents' | 'otto';

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
	{ id: 'agents', label: 'Agents' },
	{ id: 'otto', label: 'Otto' },
];

interface OttoTabBarProps {
	activeTab: WorkspaceTab;
	onTabChange: (tab: WorkspaceTab) => void;
}

/**
 * Top-level workspace tab switcher: Agents (direct sessions) vs Otto (goal
 * orchestrator). Controlled by the host app — typically backed by routes
 * (/sessions vs /otto) so refreshes land on the same tab. Renders nothing
 * when otto is disabled on the server (`useOttoEnabled()`); hosts should
 * treat the active tab as 'agents' in that case.
 */
export const OttoTabBar = memo(function OttoTabBar({
	activeTab,
	onTabChange,
}: OttoTabBarProps) {
	const ottoEnabled = useOttoEnabled();
	if (!ottoEnabled) return null;
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
							<Bot className="h-3.5 w-3.5" />
						) : (
							<Target className="h-3.5 w-3.5" />
						)}
						{tab.label}
					</button>
				);
			})}
		</div>
	);
});
