import { useCallback, useMemo } from 'react';
import { create } from 'zustand';

interface MessageHoverState {
	hoveredMessageId: string | null;
	setHoveredMessage: (messageId: string | null) => void;
}

/**
 * Tracks which turn the pointer is over. The thread renders one turn as many
 * independent list rows, so hover-driven chrome (header branch button, turn
 * footer actions) coordinates through this store instead of local state.
 */
export const useMessageHoverStore = create<MessageHoverState>((set) => ({
	hoveredMessageId: null,
	setHoveredMessage: (messageId) => set({ hoveredMessageId: messageId }),
}));

export function useIsMessageHovered(messageId: string): boolean {
	return useMessageHoverStore((state) => state.hoveredMessageId === messageId);
}

let pendingClear: ReturnType<typeof setTimeout> | undefined;

function enterMessage(messageId: string) {
	if (pendingClear) {
		clearTimeout(pendingClear);
		pendingClear = undefined;
	}
	if (useMessageHoverStore.getState().hoveredMessageId === messageId) return;
	useMessageHoverStore.getState().setHoveredMessage(messageId);
}

function leaveMessage(messageId: string) {
	if (pendingClear) clearTimeout(pendingClear);
	// Moving between rows of the same turn fires leave-then-enter, so defer the
	// clear by a tick to keep hover chrome from flickering.
	pendingClear = setTimeout(() => {
		pendingClear = undefined;
		if (useMessageHoverStore.getState().hoveredMessageId !== messageId) return;
		useMessageHoverStore.getState().setHoveredMessage(null);
	}, 0);
}

/** Mouse handlers that mark a row's turn as hovered. */
export function useMessageHoverHandlers(messageId: string) {
	const onMouseEnter = useCallback(() => enterMessage(messageId), [messageId]);
	const onMouseLeave = useCallback(() => leaveMessage(messageId), [messageId]);
	return useMemo(
		() => ({ onMouseEnter, onMouseLeave }),
		[onMouseEnter, onMouseLeave],
	);
}
