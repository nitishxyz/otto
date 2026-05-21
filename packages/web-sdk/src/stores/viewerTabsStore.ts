import { create } from 'zustand';
import type { SessionFileOperation } from '../types/api';

export type ViewerTab =
	| {
			id: string;
			type: 'git-diff';
			title: string;
			path: string;
			staged: boolean;
	  }
	| {
			id: string;
			type: 'session-file-diff';
			title: string;
			path: string;
			operations: SessionFileOperation[];
			selectedOperationIndex: number;
	  }
	| {
			id: string;
			type: 'file';
			title: string;
			path: string;
	  }
	| {
			id: string;
			type: 'skill-file';
			title: string;
			skill: string;
			file: string | null;
	  };

interface ViewerTabsState {
	tabs: ViewerTab[];
	activeTabId: string | null;
	openGitDiffTab: (path: string, staged: boolean) => void;
	openSessionFileDiffTab: (
		path: string,
		operations: SessionFileOperation[],
	) => void;
	openFileTab: (path: string) => void;
	openSkillFileTab: (skill: string, file: string | null) => void;
	setActiveTab: (id: string) => void;
	closeTab: (id: string) => void;
	updateSessionFileOperationIndex: (id: string, index: number) => void;
	closeAllTabs: () => void;
}

function titleFromPath(path: string): string {
	return path.split('/').pop() || path;
}

function upsertTab(tabs: ViewerTab[], tab: ViewerTab): ViewerTab[] {
	const existingIndex = tabs.findIndex((item) => item.id === tab.id);
	if (existingIndex === -1) {
		return [...tabs, tab];
	}

	const next = [...tabs];
	next[existingIndex] = tab;
	return next;
}

export const useViewerTabsStore = create<ViewerTabsState>((set) => ({
	tabs: [],
	activeTabId: null,

	openGitDiffTab: (path, staged) => {
		const id = `git-diff:${staged ? 'staged' : 'unstaged'}:${path}`;
		set((state) => ({
			tabs: upsertTab(state.tabs, {
				id,
				type: 'git-diff',
				title: titleFromPath(path),
				path,
				staged,
			}),
			activeTabId: id,
		}));
	},

	openSessionFileDiffTab: (path, operations) => {
		const id = `session-file-diff:${path}`;
		set((state) => ({
			tabs: upsertTab(state.tabs, {
				id,
				type: 'session-file-diff',
				title: titleFromPath(path),
				path,
				operations,
				selectedOperationIndex: Math.max(0, operations.length - 1),
			}),
			activeTabId: id,
		}));
	},

	openFileTab: (path) => {
		const id = `file:${path}`;
		set((state) => ({
			tabs: upsertTab(state.tabs, {
				id,
				type: 'file',
				title: titleFromPath(path),
				path,
			}),
			activeTabId: id,
		}));
	},

	openSkillFileTab: (skill, file) => {
		const displayFile = file ?? 'SKILL.md';
		const id = `skill-file:${skill}:${displayFile}`;
		set((state) => ({
			tabs: upsertTab(state.tabs, {
				id,
				type: 'skill-file',
				title: titleFromPath(displayFile),
				skill,
				file,
			}),
			activeTabId: id,
		}));
	},

	setActiveTab: (id) => set({ activeTabId: id }),

	closeTab: (id) =>
		set((state) => {
			const closingIndex = state.tabs.findIndex((tab) => tab.id === id);
			const tabs = state.tabs.filter((tab) => tab.id !== id);
			let activeTabId = state.activeTabId;

			if (state.activeTabId === id) {
				activeTabId =
					tabs[closingIndex]?.id ?? tabs[closingIndex - 1]?.id ?? null;
			}

			return { tabs, activeTabId };
		}),

	updateSessionFileOperationIndex: (id, index) =>
		set((state) => ({
			tabs: state.tabs.map((tab) =>
				tab.id === id && tab.type === 'session-file-diff'
					? { ...tab, selectedOperationIndex: index }
					: tab,
			),
		})),

	closeAllTabs: () => set({ tabs: [], activeTabId: null }),
}));
