import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface RightRailState {
	isPinned: boolean;
	togglePinned: () => void;
	setPinned: (pinned: boolean) => void;
}

export const useRightRailStore = create<RightRailState>()(
	persist(
		(set) => ({
			isPinned: true,
			togglePinned: () => set((state) => ({ isPinned: !state.isPinned })),
			setPinned: (pinned) => set({ isPinned: pinned }),
		}),
		{
			name: 'right-rail-storage',
		},
	),
);
