import { create } from 'zustand';
import { useAppsStore } from './appsStore';
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
	revealFile: (path: string) => void;
	closeViewer: () => void;
	toggleDir: (path: string) => void;
}

function getAncestorDirs(path: string): string[] {
	const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '');
	const parts = normalizedPath.split('/').filter(Boolean);
	return parts
		.slice(0, -1)
		.map((_, index) => parts.slice(0, index + 1).join('/'));
}

function revealFileState(state: FileBrowserState, path: string) {
	const expandedDirs = new Set(state.expandedDirs);
	for (const dir of getAncestorDirs(path)) {
		expandedDirs.add(dir);
	}

	return {
		selectedFile: path,
		expandedDirs,
	};
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
				useAppsStore.getState().collapseSidebar();
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
		useAppsStore.getState().collapseSidebar();
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
		set((state) => ({
			...revealFileState(state, path),
			isViewerOpen: true,
		}));
	},
	revealFile: (path) => set((state) => revealFileState(state, path)),
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
