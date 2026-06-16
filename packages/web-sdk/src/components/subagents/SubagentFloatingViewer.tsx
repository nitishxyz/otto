import { memo, useCallback, useEffect, useRef } from 'react';
import { Bot, X } from 'lucide-react';
import {
	useSubagentViewerStore,
	type SubagentViewerInstance,
	type SubagentViewerPosition,
} from '../../stores/subagentViewerStore';
import { MessageThreadContainer } from '../messages/MessageThreadContainer';

const PANEL_WIDTH = 440;
const PANEL_HEIGHT = 520;
const PANEL_MARGIN = 16;
const CASCADE_OFFSET = 32;
const Z_BASE = 91;

function clampPosition(x: number, y: number): SubagentViewerPosition {
	if (typeof window === 'undefined') return { x, y };
	const maxX = Math.max(8, window.innerWidth - PANEL_WIDTH - 8);
	const maxY = Math.max(8, window.innerHeight - PANEL_HEIGHT - 8);
	return {
		x: Math.min(Math.max(x, 8), maxX),
		y: Math.min(Math.max(y, 8), maxY),
	};
}

function defaultPosition(index: number): SubagentViewerPosition {
	if (typeof window === 'undefined') return { x: 0, y: 0 };
	const offset = index * CASCADE_OFFSET;
	return clampPosition(
		window.innerWidth - PANEL_WIDTH - PANEL_MARGIN - 24 - offset,
		window.innerHeight - PANEL_HEIGHT - PANEL_MARGIN - 24 - offset,
	);
}

interface SubagentViewerPanelProps {
	viewer: SubagentViewerInstance;
	index: number;
	zIndex: number;
}

const SubagentViewerPanel = memo(function SubagentViewerPanel({
	viewer,
	index,
	zIndex,
}: SubagentViewerPanelProps) {
	const { childSessionId, agent, task } = viewer;
	const panelRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{
		pointerId: number;
		offsetX: number;
		offsetY: number;
		last: SubagentViewerPosition | null;
	} | null>(null);

	const storedPosition = useSubagentViewerStore(
		(state) => state.positions[childSessionId],
	);
	const setPosition = useSubagentViewerStore((state) => state.setPosition);
	const bringToFront = useSubagentViewerStore((state) => state.bringToFront);
	const close = useSubagentViewerStore((state) => state.close);

	const position = storedPosition
		? clampPosition(storedPosition.x, storedPosition.y)
		: defaultPosition(index);

	const handleClose = useCallback(
		() => close(childSessionId),
		[close, childSessionId],
	);

	const handlePanelPointerDown = useCallback(
		() => bringToFront(childSessionId),
		[bringToFront, childSessionId],
	);

	const handleHeaderPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) return;
			if ((event.target as HTMLElement).closest('button')) return;
			const panel = panelRef.current;
			if (!panel) return;
			const rect = panel.getBoundingClientRect();
			dragRef.current = {
				pointerId: event.pointerId,
				offsetX: event.clientX - rect.left,
				offsetY: event.clientY - rect.top,
				last: null,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[],
	);

	const handleHeaderPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== event.pointerId) return;
			const panel = panelRef.current;
			if (!panel) return;
			const next = clampPosition(
				event.clientX - drag.offsetX,
				event.clientY - drag.offsetY,
			);
			drag.last = next;
			panel.style.left = `${next.x}px`;
			panel.style.top = `${next.y}px`;
		},
		[],
	);

	const handleHeaderPointerEnd = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== event.pointerId) return;
			dragRef.current = null;
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			if (drag.last) setPosition(childSessionId, drag.last);
		},
		[setPosition, childSessionId],
	);

	return (
		<div
			ref={panelRef}
			onPointerDown={handlePanelPointerDown}
			className="fixed flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
			style={{
				left: position.x,
				top: position.y,
				width: PANEL_WIDTH,
				height: PANEL_HEIGHT,
				zIndex,
			}}
		>
			<div
				onPointerDown={handleHeaderPointerDown}
				onPointerMove={handleHeaderPointerMove}
				onPointerUp={handleHeaderPointerEnd}
				onPointerCancel={handleHeaderPointerEnd}
				className="flex cursor-grab touch-none select-none items-center gap-2 border-b border-border px-3 py-2 active:cursor-grabbing"
			>
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
					onClick={handleClose}
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

/**
 * Floating read-only viewers for running/finished sub-agent sessions.
 * Supports multiple boxes at once; each is draggable via its header and
 * keeps its position (per child session) while the app is open.
 */
export const SubagentFloatingViewer = memo(function SubagentFloatingViewer() {
	const viewers = useSubagentViewerStore((state) => state.viewers);
	const close = useSubagentViewerStore((state) => state.close);

	useEffect(() => {
		if (viewers.length === 0) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			const topmost = viewers.reduce((top, viewer) =>
				viewer.z > top.z ? viewer : top,
			);
			close(topmost.childSessionId);
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [viewers, close]);

	if (viewers.length === 0) return null;

	const zRanks = [...viewers]
		.sort((a, b) => a.z - b.z)
		.reduce<Record<string, number>>((acc, viewer, rank) => {
			acc[viewer.childSessionId] = Z_BASE + rank;
			return acc;
		}, {});

	return (
		<>
			{viewers.map((viewer, index) => (
				<SubagentViewerPanel
					key={viewer.childSessionId}
					viewer={viewer}
					index={index}
					zIndex={zRanks[viewer.childSessionId]}
				/>
			))}
		</>
	);
});
