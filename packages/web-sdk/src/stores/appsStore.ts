import { create } from 'zustand';
import { useAgentsStore } from './agentsStore';
import { useFileBrowserStore } from './fileBrowserStore';
import { useGitStore } from './gitStore';
import { useMCPStore } from './mcpStore';
import { useSessionFilesStore } from './sessionFilesStore';
import { useSettingsStore } from './settingsStore';
import { useSkillsStore } from './skillsStore';
import { useTunnelStore } from './tunnelStore';

interface AppsState {
	isExpanded: boolean;
	toggleSidebar: () => void;
	expandSidebar: () => void;
	collapseSidebar: () => void;
}

function collapseSiblingPanels() {
	useGitStore.getState().collapseSidebar();
	useSessionFilesStore.getState().collapseSidebar();
	useSettingsStore.getState().collapseSidebar();
	useTunnelStore.getState().collapseSidebar();
	useFileBrowserStore.getState().collapseSidebar();
	useMCPStore.getState().collapseSidebar();
	useSkillsStore.getState().collapseSidebar();
	useAgentsStore.getState().closeManager();
}

export const useAppsStore = create<AppsState>((set) => ({
	isExpanded: false,
	toggleSidebar: () =>
		set((state) => {
			const isExpanded = !state.isExpanded;
			if (isExpanded) collapseSiblingPanels();
			return { isExpanded };
		}),
	expandSidebar: () => {
		collapseSiblingPanels();
		set({ isExpanded: true });
	},
	collapseSidebar: () => set({ isExpanded: false }),
}));
