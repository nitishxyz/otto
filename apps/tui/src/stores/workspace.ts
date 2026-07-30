import { create } from 'zustand';
import type {
	ActivityDetail,
	ActivityFocus,
	ActivityTab,
} from '../components/activity/types.ts';

interface WorkspaceState {
	isOpen: boolean;
	tab: ActivityTab;
	focus: ActivityFocus;
	detail: ActivityDetail | null;
	toggle: () => void;
	open: (tab?: ActivityTab) => void;
	close: () => void;
	setTab: (tab: ActivityTab) => void;
	setFocus: (focus: ActivityFocus) => void;
	openDetail: (detail: ActivityDetail) => void;
	back: () => void;
	resetDetail: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
	isOpen: false,
	tab: 'todos',
	focus: 'chat',
	detail: null,

	toggle: () => {
		const { isOpen } = get();
		set(
			isOpen
				? { isOpen: false, focus: 'chat', detail: null }
				: { isOpen: true, focus: 'activity' },
		);
	},
	open: (tab) =>
		set({ isOpen: true, focus: 'activity', ...(tab ? { tab } : {}) }),
	close: () => set({ isOpen: false, focus: 'chat', detail: null }),
	setTab: (tab) => set({ tab, focus: 'activity' }),
	setFocus: (focus) => set({ focus }),
	openDetail: (detail) => set({ detail, isOpen: true, focus: 'detail' }),
	back: () => {
		const { focus } = get();
		if (focus === 'detail') set({ detail: null, focus: 'activity' });
		else if (focus === 'activity') set({ focus: 'chat' });
	},
	resetDetail: () => set({ detail: null, focus: 'chat' }),
}));
