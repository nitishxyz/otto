import { create } from 'zustand';
import { useSessionFilesStore } from './sessionFilesStore';
import { useResearchStore } from './researchStore';
import { useSettingsStore } from './settingsStore';
import { useTunnelStore } from './tunnelStore';
import { useFileBrowserStore } from './fileBrowserStore';
import { useMCPStore } from './mcpStore';
import { useSkillsStore } from './skillsStore';
import { useViewerTabsStore } from './viewerTabsStore';

interface GitState {
	// Sidebar state
	isExpanded: boolean;

	// Active session tracking (for commit message generation)
	activeSessionId: string | null;

	// Diff panel state
	selectedFile: string | null;
	selectedFileStaged: boolean;
	isDiffOpen: boolean;

	// Commit modal state
	isCommitModalOpen: boolean;
	commitSessionId: string | null;

	// Session list collapse state (when diff is open)
	wasSessionListCollapsed: boolean;

	// Actions
	toggleSidebar: () => void;
	expandSidebar: () => void;
	collapseSidebar: () => void;

	openDiff: (file: string, staged: boolean) => void;
	closeDiff: () => void;
	switchFile: (file: string, staged: boolean) => void;

	openCommitModal: () => void;
	openCommitModalForSession: (sessionId: string) => void;
	closeCommitModal: () => void;

	setActiveSessionId: (sessionId: string | null) => void;
	setSessionListCollapsed: (collapsed: boolean) => void;
}

export const useGitStore = create<GitState>((set) => ({
	// Initial state
	isExpanded: false,
	activeSessionId: null,
	selectedFile: null,
	selectedFileStaged: false,
	isDiffOpen: false,
	isCommitModalOpen: false,
	commitSessionId: null,
	wasSessionListCollapsed: false,

	// Sidebar actions
	toggleSidebar: () => {
		set((state) => {
			const newExpanded = !state.isExpanded;
			if (newExpanded) {
				useSessionFilesStore.getState().collapseSidebar();
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
	expandSidebar: () => set({ isExpanded: true }),
	collapseSidebar: () =>
		set({ isExpanded: false, isDiffOpen: false, selectedFile: null }),

	// Diff panel actions
	openDiff: (file, staged) => {
		useViewerTabsStore.getState().openGitDiffTab(file, staged);
		set({
			selectedFile: file,
			selectedFileStaged: staged,
			isDiffOpen: true,
			isExpanded: true,
		});
	},
	closeDiff: () =>
		set({
			isDiffOpen: false,
			selectedFile: null,
		}),
	switchFile: (file, staged) =>
		set({
			selectedFile: file,
			selectedFileStaged: staged,
		}),

	// Commit modal actions
	openCommitModal: () =>
		set((state) => ({
			isCommitModalOpen: true,
			commitSessionId: state.activeSessionId,
		})),
	openCommitModalForSession: (sessionId: string) =>
		set({ isCommitModalOpen: true, commitSessionId: sessionId }),
	closeCommitModal: () =>
		set({ isCommitModalOpen: false, commitSessionId: null }),

	// Session list collapse
	setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),
	setSessionListCollapsed: (collapsed) =>
		set({ wasSessionListCollapsed: collapsed }),
}));
