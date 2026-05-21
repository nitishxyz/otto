import { create } from 'zustand';
import { useGitStore } from './gitStore';
import { useSessionFilesStore } from './sessionFilesStore';
import { useResearchStore } from './researchStore';
import { useSettingsStore } from './settingsStore';
import { useTunnelStore } from './tunnelStore';
import { useMCPStore } from './mcpStore';
import { useSkillsStore } from './skillsStore';
import { useViewerTabsStore } from './viewerTabsStore';

interface FileBrowserState {
	isExpanded: boolean;
	selectedFile: string | null;
	isViewerOpen: boolean;
	expandedDirs: Set<string>;

	toggleSidebar: () => void;
	expandSidebar: () => void;
	collapseSidebar: () => void;
	openFile: (path: string) => void;
	closeViewer: () => void;
	toggleDir: (path: string) => void;
}

export const useFileBrowserStore = create<FileBrowserState>((set) => ({
	isExpanded: false,
	selectedFile: null,
	isViewerOpen: false,
	expandedDirs: new Set<string>(),

	toggleSidebar: () => {
		set((state) => {
			const newExpanded = !state.isExpanded;
			if (newExpanded) {
				useGitStore.getState().collapseSidebar();
				useSessionFilesStore.getState().collapseSidebar();
				useResearchStore.getState().collapseSidebar();
				useSettingsStore.getState().collapseSidebar();
				useTunnelStore.getState().collapseSidebar();
				useMCPStore.getState().collapseSidebar();
				useSkillsStore.getState().collapseSidebar();
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
		useMCPStore.getState().collapseSidebar();
		useSkillsStore.getState().collapseSidebar();
		set({ isExpanded: true });
	},
	collapseSidebar: () =>
		set({
			isExpanded: false,
			isViewerOpen: false,
			selectedFile: null,
		}),
	openFile: (path) => {
		useViewerTabsStore.getState().openFileTab(path);
		set({
			selectedFile: path,
			isViewerOpen: true,
		});
	},
	closeViewer: () =>
		set({
			isViewerOpen: false,
			selectedFile: null,
		}),
	toggleDir: (path) =>
		set((state) => {
			const next = new Set(state.expandedDirs);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return { expandedDirs: next };
		}),
}));
