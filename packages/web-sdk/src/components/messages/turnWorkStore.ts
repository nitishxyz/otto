import { create } from 'zustand';

interface TurnWorkState {
	expandedMessageIds: ReadonlySet<string>;
	toggleExpanded: (messageId: string) => void;
	clearExpanded: () => void;
}

/**
 * Which older turns have their tool work expanded. The latest turn is never
 * collapsed, so it is not tracked here.
 */
export const useTurnWorkStore = create<TurnWorkState>((set) => ({
	expandedMessageIds: new Set(),
	toggleExpanded: (messageId) =>
		set((state) => {
			const next = new Set(state.expandedMessageIds);
			if (next.has(messageId)) next.delete(messageId);
			else next.add(messageId);
			return { expandedMessageIds: next };
		}),
	clearExpanded: () => set({ expandedMessageIds: new Set() }),
}));
