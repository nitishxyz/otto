import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useConfig } from '../../hooks/useConfig';
import { getSessionsQueryKey, useSessions } from '../../hooks/useSessions';
import { getMessagesQueryKey } from '../../hooks/useMessages';
import { apiClient } from '../../lib/api-client';
import { formatFileSelectionForMessage } from '../../lib/fileSelectionContext';
import { toast } from '../../stores/toastStore';
import { useBtwStore } from '../../stores/btwStore';
import { ChatInput } from '../chat/ChatInput';
import { MessageThreadContainer } from '../messages/MessageThreadContainer';

const PANEL_WIDTH = 440;
const PANEL_MARGIN = 12;
const EMPTY_HEIGHT = 132;
const ACTIVE_HEIGHT = 520;

export const BtwFloatingChat = memo(function BtwFloatingChat() {
	const isOpen = useBtwStore((state) => state.isOpen);
	const selection = useBtwStore((state) => state.selection);
	const parentSessionId = useBtwStore((state) => state.parentSessionId);
	const sessionId = useBtwStore((state) => state.sessionId);
	const anchorRect = useBtwStore((state) => state.anchorRect);
	const setSessionId = useBtwStore((state) => state.setSessionId);
	const close = useBtwStore((state) => state.close);
	const { data: config } = useConfig();
	const { data: sessions = [] } = useSessions();
	const queryClient = useQueryClient();
	const [sending, setSending] = useState(false);

	const parentSession = useMemo(
		() => sessions.find((session) => session.id === parentSessionId),
		[sessions, parentSessionId],
	);

	const handleSend = useCallback(
		async (content: string) => {
			const trimmed = content.trim();
			if (!trimmed || sending || !selection) return;

			setSending(true);
			try {
				let activeSessionId = sessionId;
				if (!activeSessionId) {
					const session = await apiClient.createSession({
						title: 'BTW',
						agent: parentSession?.agent ?? config?.defaults.agent ?? 'general',
						provider: parentSession?.provider ?? config?.defaults.provider,
						model: parentSession?.model ?? config?.defaults.model,
						parentSessionId,
						sessionType: 'btw',
					});
					activeSessionId = session.id;
					setSessionId(session.id);
					queryClient.invalidateQueries({ queryKey: getSessionsQueryKey() });
				}

				const contextPrefix = formatFileSelectionForMessage(selection);
				await apiClient.sendMessage(activeSessionId, {
					content: `${contextPrefix}\n\n${trimmed}`,
					agent: parentSession?.agent ?? config?.defaults.agent ?? undefined,
					provider:
						parentSession?.provider ?? config?.defaults.provider ?? undefined,
					model: parentSession?.model ?? config?.defaults.model ?? undefined,
					reasoningText: config?.defaults.reasoningText ?? true,
					reasoningLevel: config?.defaults.reasoningLevel ?? 'high',
				});
				queryClient.invalidateQueries({
					queryKey: getMessagesQueryKey(activeSessionId),
				});
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : 'Failed to send BTW',
				);
			} finally {
				setSending(false);
			}
		},
		[
			sending,
			selection,
			sessionId,
			parentSession,
			config,
			parentSessionId,
			setSessionId,
			queryClient,
		],
	);

	const panelHeight = sessionId ? ACTIVE_HEIGHT : EMPTY_HEIGHT;
	const position = useFloatingPosition(anchorRect, isOpen, panelHeight);

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

	if (!isOpen || !selection) return null;

	return (
		<div
			className="fixed z-[95] flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
			style={{
				top: position.top,
				left: position.left,
				width: PANEL_WIDTH,
				height: panelHeight,
			}}
		>
			<div className="flex items-center gap-2 border-b border-border px-3 py-2">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<span className="font-semibold text-sm">BTW</span>
					<span className="truncate font-mono text-[11px] text-muted-foreground">
						{selection.label}
					</span>
				</div>
				<button
					type="button"
					onClick={close}
					className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					aria-label="Close BTW chat"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			<div className="relative flex-1 min-h-0">
				{sessionId ? (
					<MessageThreadContainer
						sessionId={sessionId}
						footerBottomPaddingClass="pb-32"
					/>
				) : null}

				<div className="absolute inset-x-0 bottom-0 [&>div]:!bg-transparent [&>div]:!px-2 [&>div]:!pt-2 [&>div]:!pb-2 md:[&>div]:!px-2 md:[&>div]:!pt-2 md:[&>div]:!pb-2">
					<ChatInput
						onSend={(value) => void handleSend(value)}
						disabled={sending}
					/>
				</div>
			</div>
		</div>
	);
});

function useFloatingPosition(
	anchorRect: {
		top: number;
		left: number;
		bottom: number;
		right: number;
	} | null,
	isOpen: boolean,
	panelHeight: number,
): { top: number; left: number } {
	const initial = useMemo(
		() => computePosition(anchorRect, panelHeight),
		[anchorRect, panelHeight],
	);
	const [position, setPosition] = useState(initial);
	const lastAnchorRef = useRef(anchorRect);

	useLayoutEffect(() => {
		if (!isOpen) return;
		setPosition(computePosition(anchorRect, panelHeight));
		lastAnchorRef.current = anchorRect;
	}, [isOpen, anchorRect, panelHeight]);

	return position;
}

function computePosition(
	anchorRect: {
		top: number;
		left: number;
		bottom: number;
		right: number;
	} | null,
	panelHeight: number,
): { top: number; left: number } {
	if (typeof window === 'undefined') {
		return { top: 80, left: 80 };
	}

	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;

	if (!anchorRect) {
		return {
			top: Math.max(
				PANEL_MARGIN,
				viewportHeight - panelHeight - PANEL_MARGIN - 24,
			),
			left: Math.max(
				PANEL_MARGIN,
				viewportWidth - PANEL_WIDTH - PANEL_MARGIN - 24,
			),
		};
	}

	const centerX = (anchorRect.left + anchorRect.right) / 2;
	let left = centerX - PANEL_WIDTH / 2;
	left = Math.max(
		PANEL_MARGIN,
		Math.min(viewportWidth - PANEL_WIDTH - PANEL_MARGIN, left),
	);

	const spaceBelow = viewportHeight - anchorRect.bottom - PANEL_MARGIN;
	const spaceAbove = anchorRect.top - PANEL_MARGIN;
	let top: number;
	if (spaceBelow >= panelHeight || spaceBelow >= spaceAbove) {
		top = anchorRect.bottom + 8;
	} else {
		top = anchorRect.top - panelHeight - 8;
	}
	top = Math.max(
		PANEL_MARGIN,
		Math.min(viewportHeight - panelHeight - PANEL_MARGIN, top),
	);

	return { top, left };
}
