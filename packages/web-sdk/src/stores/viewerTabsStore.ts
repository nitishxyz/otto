import { create } from 'zustand';
import type { SessionFileOperation } from '../types/api';

export interface ToolActivityHighlight {
	startLine?: number;
	endLine?: number;
	reason: 'read' | 'write' | 'apply_patch';
	callId?: string;
	status: 'streaming' | 'success' | 'error';
}

export interface ToolPreviewTabInput {
	path: string;
	toolName: 'write' | 'apply_patch';
	callId?: string;
	content?: string;
	patch?: string;
	changedLines?: number[];
	previewContent?: string;
	previewLineTones?: Array<[number, 'add' | 'remove']>;
	previewFirstLine?: number;
	previewLatestLine?: number;
	status: 'streaming' | 'success' | 'error';
	error?: string;
}

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
			highlight?: ToolActivityHighlight;
	  }
	| {
			id: string;
			type: 'tool-preview';
			title: string;
			path: string;
			toolName: 'write' | 'apply_patch';
			callId?: string;
			content?: string;
			patch?: string;
			changedLines?: number[];
			previewContent?: string;
			previewLineTones?: Array<[number, 'add' | 'remove']>;
			previewFirstLine?: number;
			previewLatestLine?: number;
			status: 'streaming' | 'success' | 'error';
			error?: string;
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
	followToolActivity: boolean;
	toggleFollowToolActivity: () => void;
	setFollowToolActivity: (enabled: boolean) => void;
	openGitDiffTab: (path: string, staged: boolean) => void;
	openSessionFileDiffTab: (
		path: string,
		operations: SessionFileOperation[],
	) => void;
	openFileTab: (path: string) => void;
	openToolReadTab: (path: string, highlight: ToolActivityHighlight) => void;
	openToolPreviewTab: (preview: ToolPreviewTabInput) => void;
	openSkillFileTab: (skill: string, file: string | null) => void;
	setActiveTab: (id: string) => void;
	closeTab: (id: string) => void;
	updateSessionFileOperationIndex: (id: string, index: number) => void;
	closeAllTabs: () => void;
}

function titleFromPath(path: string): string {
	return path.split('/').pop() || path;
}

function fileTabId(path: string): string {
	return `file:${path}`;
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
	followToolActivity: false,

	toggleFollowToolActivity: () =>
		set((state) => ({ followToolActivity: !state.followToolActivity })),

	setFollowToolActivity: (enabled) => set({ followToolActivity: enabled }),

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
		const id = fileTabId(path);
		set((state) => {
			const tabs = state.tabs.filter(
				(tab) =>
					!(tab.type === 'tool-preview' && tab.path === path && tab.id !== id),
			);
			return {
				tabs: upsertTab(tabs, {
					id,
					type: 'file',
					title: titleFromPath(path),
					path,
				}),
				activeTabId: id,
			};
		});
	},

	openToolReadTab: (path, highlight) => {
		const id = fileTabId(path);
		set((state) => {
			const tabs = state.tabs.filter(
				(tab) =>
					!(tab.type === 'tool-preview' && tab.path === path && tab.id !== id),
			);
			return {
				tabs: upsertTab(tabs, {
					id,
					type: 'file',
					title: titleFromPath(path),
					path,
					highlight,
				}),
				activeTabId: id,
			};
		});
	},

	openToolPreviewTab: (preview) => {
		const id = fileTabId(preview.path);
		set((state) => {
			const existing = state.tabs.find(
				(tab): tab is Extract<ViewerTab, { type: 'tool-preview' }> =>
					tab.id === id && tab.type === 'tool-preview',
			);
			const tabs = state.tabs.filter(
				(tab) =>
					!(
						tab.type === 'tool-preview' &&
						tab.id !== id &&
						(tab.path === preview.path ||
							Boolean(preview.callId && tab.callId === preview.callId))
					),
			);
			return {
				tabs: upsertTab(tabs, {
					id,
					type: 'tool-preview',
					title: titleFromPath(preview.path),
					path: preview.path,
					toolName: preview.toolName,
					callId: preview.callId,
					content: preview.content ?? existing?.content,
					patch: preview.patch ?? existing?.patch,
					changedLines: preview.changedLines ?? existing?.changedLines,
					previewContent: preview.previewContent ?? existing?.previewContent,
					previewLineTones:
						preview.previewLineTones ?? existing?.previewLineTones,
					previewFirstLine:
						preview.previewFirstLine ?? existing?.previewFirstLine,
					previewLatestLine:
						preview.previewLatestLine ?? existing?.previewLatestLine,
					status: preview.status,
					error: preview.error ?? existing?.error,
				}),
				activeTabId: id,
			};
		});
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
