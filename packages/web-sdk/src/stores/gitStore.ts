import { create } from 'zustand';
import { useSessionFilesStore } from './sessionFilesStore';
import { useResearchStore } from './researchStore';
import { useSettingsStore } from './settingsStore';
import { useTunnelStore } from './tunnelStore';
import { useFileBrowserStore } from './fileBrowserStore';
import { useMCPStore } from './mcpStore';
import { useSkillsStore } from './skillsStore';
import { useViewerTabsStore } from './viewerTabsStore';

export interface GitTreeRow {
	id: string;
	type: 'file' | 'folder';
	path: string;
	staged: boolean;
	status?: string;
	actionPaths: string[];
	open?: () => void;
	toggleExpanded?: () => void;
}

const GIT_TREE_SECTION_ORDER = ['conflicts', 'staged', 'changes'];

function areGitTreeRowsEqual(
	left: GitTreeRow[] = [],
	right: GitTreeRow[] = [],
) {
	if (left.length !== right.length) return false;

	return left.every((row, index) => {
		const other = right[index];
		return (
			row.id === other.id &&
			row.type === other.type &&
			row.path === other.path &&
			row.staged === other.staged &&
			row.status === other.status &&
			row.actionPaths.length === other.actionPaths.length &&
			row.actionPaths.every(
				(path, pathIndex) => path === other.actionPaths[pathIndex],
			)
		);
	});
}

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

	// Visible Git tree rows for keyboard navigation
	gitTreeKnownFolders: Record<string, Set<string>>;
	gitTreeExpandedFolders: Record<string, Set<string>>;
	gitTreeSections: Record<string, GitTreeRow[]>;
	gitTreeRows: GitTreeRow[];

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
	syncGitTreeFolders: (sectionId: string, paths: string[]) => void;
	toggleGitTreeFolder: (sectionId: string, path: string) => void;
	setGitTreeSectionRows: (sectionId: string, rows: GitTreeRow[]) => void;
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
	gitTreeKnownFolders: {},
	gitTreeExpandedFolders: {},
	gitTreeSections: {},
	gitTreeRows: [],

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
	syncGitTreeFolders: (sectionId, paths) =>
		set((state) => {
			const knownFolders = state.gitTreeKnownFolders[sectionId] ?? new Set();
			const expandedFolders =
				state.gitTreeExpandedFolders[sectionId] ?? new Set();
			let changed = false;
			const nextKnownFolders = new Set(knownFolders);
			const nextExpandedFolders = new Set(expandedFolders);

			for (const path of paths) {
				if (!nextKnownFolders.has(path)) {
					nextKnownFolders.add(path);
					nextExpandedFolders.add(path);
					changed = true;
				}
			}

			if (!changed) return state;

			return {
				gitTreeKnownFolders: {
					...state.gitTreeKnownFolders,
					[sectionId]: nextKnownFolders,
				},
				gitTreeExpandedFolders: {
					...state.gitTreeExpandedFolders,
					[sectionId]: nextExpandedFolders,
				},
			};
		}),
	toggleGitTreeFolder: (sectionId, path) =>
		set((state) => {
			const expandedFolders =
				state.gitTreeExpandedFolders[sectionId] ?? new Set();
			const nextExpandedFolders = new Set(expandedFolders);

			if (nextExpandedFolders.has(path)) nextExpandedFolders.delete(path);
			else nextExpandedFolders.add(path);

			return {
				gitTreeExpandedFolders: {
					...state.gitTreeExpandedFolders,
					[sectionId]: nextExpandedFolders,
				},
			};
		}),
	setGitTreeSectionRows: (sectionId, rows) =>
		set((state) => {
			if (areGitTreeRowsEqual(state.gitTreeSections[sectionId], rows)) {
				return state;
			}

			const gitTreeSections = {
				...state.gitTreeSections,
				[sectionId]: rows,
			};
			const gitTreeRows = GIT_TREE_SECTION_ORDER.flatMap(
				(id) => gitTreeSections[id] ?? [],
			);

			return { gitTreeSections, gitTreeRows };
		}),
}));
