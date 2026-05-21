import { create } from 'zustand';
import { useGitStore } from './gitStore';
import { useSessionFilesStore } from './sessionFilesStore';
import { useResearchStore } from './researchStore';
import { useSettingsStore } from './settingsStore';
import { useTunnelStore } from './tunnelStore';
import { useFileBrowserStore } from './fileBrowserStore';
import { useMCPStore } from './mcpStore';
import { useViewerTabsStore } from './viewerTabsStore';

export interface SkillInfo {
	name: string;
	description: string;
	scope: string;
	path: string;
	enabled?: boolean;
}

interface SkillsState {
	isExpanded: boolean;
	skills: SkillInfo[];
	globalEnabled: boolean;
	totalCount: number;
	enabledCount: number;
	selectedSkill: string | null;

	isViewerOpen: boolean;
	viewingFile: string | null;

	toggleSidebar: () => void;
	expandSidebar: () => void;
	collapseSidebar: () => void;
	setSkills: (skills: SkillInfo[]) => void;
	setSkillsConfig: (input: {
		skills: SkillInfo[];
		globalEnabled: boolean;
		totalCount: number;
		enabledCount: number;
	}) => void;
	selectSkill: (name: string | null) => void;
	openViewer: (file: string | null) => void;
	closeViewer: () => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
	isExpanded: false,
	skills: [],
	globalEnabled: true,
	totalCount: 0,
	enabledCount: 0,
	selectedSkill: null,
	isViewerOpen: false,
	viewingFile: null,

	toggleSidebar: () => {
		set((state) => {
			const newExpanded = !state.isExpanded;
			if (newExpanded) {
				useGitStore.getState().collapseSidebar();
				useSessionFilesStore.getState().collapseSidebar();
				useResearchStore.getState().collapseSidebar();
				useSettingsStore.getState().collapseSidebar();
				useTunnelStore.getState().collapseSidebar();
				useFileBrowserStore.getState().collapseSidebar();
				useMCPStore.getState().collapseSidebar();
			}
			return { isExpanded: newExpanded };
		});
	},

	expandSidebar: () => {
		useGitStore.getState().collapseSidebar();
		useSessionFilesStore.getState().collapseSidebar();
		useResearchStore.getState().collapseSidebar();
		useSettingsStore.getState().collapseSidebar();
		useTunnelStore.getState().collapseSidebar();
		useFileBrowserStore.getState().collapseSidebar();
		useMCPStore.getState().collapseSidebar();
		set({ isExpanded: true });
	},

	collapseSidebar: () => set({ isExpanded: false }),

	setSkills: (skills) => set({ skills }),
	setSkillsConfig: ({ skills, globalEnabled, totalCount, enabledCount }) =>
		set({ skills, globalEnabled, totalCount, enabledCount }),

	selectSkill: (name) =>
		set({ selectedSkill: name, isViewerOpen: false, viewingFile: null }),

	openViewer: (file) => {
		const selectedSkill = get().selectedSkill;
		if (selectedSkill) {
			useViewerTabsStore.getState().openSkillFileTab(selectedSkill, file);
		}
		set({ isViewerOpen: true, viewingFile: file });
	},

	closeViewer: () => set({ isViewerOpen: false, viewingFile: null }),
}));
