import { create } from 'zustand';
import { useGitStore } from './gitStore';
import { useSessionFilesStore } from './sessionFilesStore';
import { useResearchStore } from './researchStore';
import { useSettingsStore } from './settingsStore';
import { useTunnelStore } from './tunnelStore';
import { useFileBrowserStore } from './fileBrowserStore';
import { useMCPStore } from './mcpStore';
import { useSkillsStore } from './skillsStore';

interface GoalsPanelState {
	isExpanded: boolean;
	toggleSidebar: () => void;
	expandSidebar: () => void;
	collapseSidebar: () => void;
}

const otherPanelStores = [
	useGitStore,
	useSessionFilesStore,
	useResearchStore,
	useSettingsStore,
	useTunnelStore,
	useFileBrowserStore,
	useMCPStore,
	useSkillsStore,
] as const;

function collapseOtherPanels() {
	for (const store of otherPanelStores) {
		store.getState().collapseSidebar();
	}
}

export const useGoalsPanelStore = create<GoalsPanelState>((set) => ({
	isExpanded: false,

	toggleSidebar: () => {
		set((state) => {
			const newExpanded = !state.isExpanded;
			if (newExpanded) collapseOtherPanels();
			return { isExpanded: newExpanded };
		});
	},
	expandSidebar: () => {
		collapseOtherPanels();
		set({ isExpanded: true });
	},
	collapseSidebar: () => set({ isExpanded: false }),
}));

// Collapse the goals panel whenever any other right panel expands, without
// editing every existing store's hardcoded collapse list.
for (const store of otherPanelStores) {
	store.subscribe((state, prevState) => {
		if (
			(state as { isExpanded?: boolean }).isExpanded &&
			!(prevState as { isExpanded?: boolean }).isExpanded
		) {
			useGoalsPanelStore.getState().collapseSidebar();
		}
	});
}
