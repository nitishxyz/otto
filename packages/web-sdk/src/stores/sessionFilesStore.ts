import { create } from 'zustand';
import { useGitStore } from './gitStore';
import { useResearchStore } from './researchStore';
import { useSettingsStore } from './settingsStore';
import { useTunnelStore } from './tunnelStore';
import { useFileBrowserStore } from './fileBrowserStore';
import { useMCPStore } from './mcpStore';
import { useSkillsStore } from './skillsStore';
import { useViewerTabsStore } from './viewerTabsStore';
import type { SessionFileOperation } from '../types/api';

interface SessionFilesState {
	isExpanded: boolean;
	selectedFile: string | null;
	allOperations: SessionFileOperation[];
	selectedOperationIndex: number;
	isDiffOpen: boolean;

	toggleSidebar: () => void;
	expandSidebar: () => void;
	collapseSidebar: () => void;
	openDiff: (file: string, operations: SessionFileOperation[]) => void;
	selectOperation: (index: number) => void;
	closeDiff: () => void;
}

export const useSessionFilesStore = create<SessionFilesState>((set) => ({
	isExpanded: false,
	selectedFile: null,
	allOperations: [],
	selectedOperationIndex: 0,
	isDiffOpen: false,

	toggleSidebar: () => {
		set((state) => {
			const newExpanded = !state.isExpanded;
			if (newExpanded) {
				useGitStore.getState().collapseSidebar();
				useResearchStore.getState().collapseSidebar();
				useSettingsStore.getState().collapseSidebar();
				useTunnelStore.getState().collapseSidebar();
				useFileBrowserStore.getState().collapseSidebar();
				useMCPStore.getState().collapseSidebar();
				useSkillsStore.getState().collapseSidebar();
			}
			return { isExpanded: newExpanded };
		});
	},
	expandSidebar: () => {
		useGitStore.getState().collapseSidebar();
		useResearchStore.getState().collapseSidebar();
		useSettingsStore.getState().collapseSidebar();
		useTunnelStore.getState().collapseSidebar();
		useFileBrowserStore.getState().collapseSidebar();
		useMCPStore.getState().collapseSidebar();
		useSkillsStore.getState().collapseSidebar();
		set({ isExpanded: true });
	},
	collapseSidebar: () =>
		set({
			isExpanded: false,
			isDiffOpen: false,
			selectedFile: null,
			allOperations: [],
			selectedOperationIndex: 0,
		}),
	openDiff: (file, operations) => {
		useViewerTabsStore.getState().openSessionFileDiffTab(file, operations);
		set({
			selectedFile: file,
			allOperations: operations,
			selectedOperationIndex: operations.length - 1,
			isDiffOpen: true,
			isExpanded: true,
		});
	},
	selectOperation: (index) => set({ selectedOperationIndex: index }),
	closeDiff: () =>
		set({
			isDiffOpen: false,
			selectedFile: null,
			allOperations: [],
			selectedOperationIndex: 0,
		}),
}));
