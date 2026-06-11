import { memo, useEffect } from 'react';
import { Bot, X } from 'lucide-react';
import { useSubagentViewerStore } from '../../stores/subagentViewerStore';
import { useSessionStream } from '../../hooks/useSessionStream';
import { MessageThreadContainer } from '../messages/MessageThreadContainer';

const PANEL_WIDTH = 440;
const PANEL_HEIGHT = 520;
const PANEL_MARGIN = 16;

/**
 * Floating read-only viewer for a running/finished sub-agent session,
 * styled like the BTW floating chat. Streams the child session live.
 */
export const SubagentFloatingViewer = memo(function SubagentFloatingViewer() {
	const isOpen = useSubagentViewerStore((state) => state.isOpen);
	const childSessionId = useSubagentViewerStore(
		(state) => state.childSessionId,
	);
	const agent = useSubagentViewerStore((state) => state.agent);
	const task = useSubagentViewerStore((state) => state.task);
	const close = useSubagentViewerStore((state) => state.close);

	useSessionStream(isOpen ? (childSessionId ?? undefined) : undefined, true);

	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				close();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isOpen, close]);

	if (!isOpen || !childSessionId) return null;

	return (
		<div
			className="fixed z-[95] flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
			style={{
				bottom: PANEL_MARGIN + 24,
				right: PANEL_MARGIN + 24,
				width: PANEL_WIDTH,
				height: PANEL_HEIGHT,
			}}
		>
			<div className="flex items-center gap-2 border-b border-border px-3 py-2">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
					<span className="font-semibold text-sm">{agent ?? 'Sub-agent'}</span>
					{task ? (
						<span className="truncate font-mono text-[11px] text-muted-foreground">
							{task}
						</span>
					) : null}
				</div>
				<button
					type="button"
					onClick={close}
					className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					aria-label="Close sub-agent viewer"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			<div className="relative flex-1 min-h-0">
				<MessageThreadContainer
					sessionId={childSessionId}
					footerBottomPaddingClass="pb-6"
				/>
			</div>
		</div>
	);
});
