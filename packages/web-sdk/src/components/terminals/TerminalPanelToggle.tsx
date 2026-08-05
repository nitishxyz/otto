import { memo, useEffect } from 'react';
import { Terminal } from 'lucide-react';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import { useTerminals } from '../../hooks/useTerminals';
import { useToggleTerminalTabs } from '../../hooks/useTerminalTabs';
import { Tooltip } from '../ui/Tooltip';

export const TerminalPanelToggle = memo(function TerminalPanelToggle() {
	const isActive = useViewerTabsStore((state) => {
		const tab = state.activeTabId
			? state.tabsById[state.activeTabId]
			: undefined;
		return tab?.type === 'terminal' && !state.isCollapsed;
	});
	const toggleTerminalTabs = useToggleTerminalTabs();
	const { data } = useTerminals();

	const count = data?.count ?? 0;

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === '`' && e.ctrlKey) {
				e.preventDefault();
				void toggleTerminalTabs();
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [toggleTerminalTabs]);

	return (
		<Tooltip content="Terminals (Ctrl+`)" side="left">
			<button
				type="button"
				onClick={() => void toggleTerminalTabs()}
				className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center ${
					isActive ? 'bg-muted border-r-2 border-primary' : 'hover:bg-muted/50'
				}`}
				aria-label="Terminals (Ctrl+`)"
			>
				<Terminal className="w-5 h-5 text-muted-foreground mx-auto" />
				{count > 0 && (
					<span className="absolute top-1 right-1 w-5 h-5 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center font-semibold">
						{count > 9 ? '9+' : count}
					</span>
				)}
			</button>
		</Tooltip>
	);
});
