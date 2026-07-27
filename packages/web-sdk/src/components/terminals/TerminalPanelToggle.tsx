import { memo } from 'react';
import { Terminal } from 'lucide-react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useTerminals } from '../../hooks/useTerminals';
import { Tooltip } from '../ui/Tooltip';

export const TerminalPanelToggle = memo(function TerminalPanelToggle() {
	const isOpen = useTerminalStore((s) => s.isOpen);
	const togglePanel = useTerminalStore((s) => s.togglePanel);
	const { data } = useTerminals();

	const count = data?.count ?? 0;

	return (
		<Tooltip content="Terminals (⌘J / Ctrl+J)" side="left">
			<button
				type="button"
				onClick={togglePanel}
				className={`relative h-12 w-full transition-colors touch-manipulation flex items-center justify-center ${
					isOpen ? 'bg-muted border-r-2 border-primary' : 'hover:bg-muted/50'
				}`}
				aria-label="Terminals (⌘J / Ctrl+J)"
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
