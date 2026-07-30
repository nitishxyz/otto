import { memo, useCallback } from 'react';
import type { ComponentType } from 'react';
import { useKillTerminal } from '../../hooks/useTerminals';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import { TerminalViewer, type TerminalViewerProps } from './TerminalViewer';

export interface TerminalViewerPaneProps {
	tabId: string;
	terminalId: string;
	isActive: boolean;
	/** Override the terminal renderer (defaults to web TerminalViewer). */
	Viewer?: ComponentType<TerminalViewerProps>;
}

/** Hosts one daemon terminal inside a viewer tab pane. */
export const TerminalViewerPane = memo(function TerminalViewerPane({
	tabId,
	terminalId,
	isActive,
	Viewer = TerminalViewer,
}: TerminalViewerPaneProps) {
	const killTerminal = useKillTerminal();
	const closeTab = useViewerTabsStore((state) => state.closeTab);

	const handleExit = useCallback(
		async (id: string) => {
			closeTab(tabId);
			try {
				await killTerminal.mutateAsync(id);
			} catch {
				// ignore
			}
		},
		[closeTab, tabId, killTerminal],
	);

	return (
		<div className="h-full w-full bg-background">
			<Viewer terminalId={terminalId} isActive={isActive} onExit={handleExit} />
		</div>
	);
});
