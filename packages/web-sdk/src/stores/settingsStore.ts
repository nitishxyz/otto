import { create } from 'zustand';
import { useAppsStore } from './appsStore';
import { useGitStore } from './gitStore';
import { useSessionFilesStore } from './sessionFilesStore';
import { useResearchStore } from './researchStore';
import { useTunnelStore } from './tunnelStore';
import { useFileBrowserStore } from './fileBrowserStore';
import { useMCPStore } from './mcpStore';
import { useSkillsStore } from './skillsStore';

export type PreferencesTab =
	| 'editor'
	| 'notifications'
	| 'automation'
	| 'reasoning'
	| 'dictation'
	| 'recipes'
	| 'references'
	| 'plugins';

interface SettingsState {
	isExpanded: boolean;
	preferencesTab: PreferencesTab | null;
	toggleSidebar: () => void;
	expandSidebar: () => void;
	collapseSidebar: () => void;
	openPreferences: (tab?: PreferencesTab) => void;
	closePreferences: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
	isExpanded: false,
	preferencesTab: null,

	toggleSidebar: () => {
		set((state) => {
			const newExpanded = !state.isExpanded;
			if (newExpanded) {
				useGitStore.getState().collapseSidebar();
				useSessionFilesStore.getState().collapseSidebar();
				useResearchStore.getState().collapseSidebar();
				useTunnelStore.getState().collapseSidebar();
				useFileBrowserStore.getState().collapseSidebar();
				useMCPStore.getState().collapseSidebar();
				useSkillsStore.getState().collapseSidebar();
				useAppsStore.getState().collapseSidebar();
			}
			return { isExpanded: newExpanded };
		});
	},
	expandSidebar: () => {
		useAppsStore.getState().collapseSidebar();
		set({ isExpanded: true });
	},
	collapseSidebar: () => set({ isExpanded: false }),
	openPreferences: (tab = 'editor') => set({ preferencesTab: tab }),
	closePreferences: () => set({ preferencesTab: null }),
}));
