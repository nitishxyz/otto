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
	baseContent?: string;
	patch?: string;
	changedLines?: number[];
	previewContent?: string;
	resultContent?: string;
	previewLineTones?: Array<[number, 'add' | 'remove']>;
	previewFirstLine?: number;
	previewLatestLine?: number;
	status: 'streaming' | 'success' | 'error';
	error?: string;
}

export type ToolPatchPreview = Omit<
	ToolPreviewTabInput,
	'toolName' | 'content'
> & {
	toolName: 'apply_patch';
};

export type ToolWritePreview = Omit<
	ToolPreviewTabInput,
	| 'toolName'
	| 'baseContent'
	| 'patch'
	| 'changedLines'
	| 'previewContent'
	| 'resultContent'
	| 'previewLineTones'
	| 'previewFirstLine'
	| 'previewLatestLine'
> & {
	toolName: 'write';
};

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
			patchPreview?: ToolPatchPreview;
			writePreview?: ToolWritePreview;
	  }
	| {
			id: string;
			type: 'tool-preview';
			title: string;
			path: string;
			toolName: 'write' | 'apply_patch';
			callId?: string;
			content?: string;
			baseContent?: string;
			patch?: string;
			changedLines?: number[];
			previewContent?: string;
			resultContent?: string;
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

function normalizeViewerPath(path: string): string {
	return path
		.trim()
		.replace(/^a\//, '')
		.replace(/^b\//, '')
		.replace(/^\.\//, '')
		.replace(/\/+/g, '/')
		.replace(/\/+$/, '');
}

function viewerPathsMatch(left: string, right: string): boolean {
	const normalizedLeft = normalizeViewerPath(left);
	const normalizedRight = normalizeViewerPath(right);
	return (
		normalizedLeft === normalizedRight ||
		normalizedLeft.endsWith(`/${normalizedRight}`) ||
		normalizedRight.endsWith(`/${normalizedLeft}`)
	);
}

function fileTabId(path: string): string {
	return `file:${normalizeViewerPath(path)}`;
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

function isSamePatchCall(
	existing: Pick<ToolPatchPreview, 'callId' | 'patch' | 'status'> | undefined,
	preview: Pick<ToolPreviewTabInput, 'callId' | 'patch' | 'status'>,
): boolean {
	if (!existing) return false;
	if (preview.callId || existing.callId) {
		return Boolean(preview.callId && existing.callId === preview.callId);
	}
	if (preview.status === 'streaming' && existing.status !== 'streaming') {
		return false;
	}
	if (!preview.patch || !existing.patch) return existing.status === 'streaming';
	return (
		preview.patch === existing.patch ||
		preview.patch.startsWith(existing.patch) ||
		existing.patch.startsWith(preview.patch)
	);
}

function mergeChangedLines(
	existing: number[] | undefined,
	incoming: number[] | undefined,
): number[] | undefined {
	if (!existing?.length) return incoming;
	if (!incoming?.length) return existing;
	return [...new Set([...existing, ...incoming])].sort((a, b) => a - b);
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
			const matchingFileTabs = state.tabs.filter(
				(tab): tab is Extract<ViewerTab, { type: 'file' }> =>
					tab.type === 'file' && viewerPathsMatch(tab.path, path),
			);
			const existingFile =
				matchingFileTabs.find((tab) => tab.id === state.activeTabId) ??
				matchingFileTabs[0];
			const targetId = existingFile?.id ?? id;
			const targetPath = existingFile?.path ?? path;
			const tabs = state.tabs.filter(
				(tab) =>
					!(
						(tab.type === 'tool-preview' || tab.type === 'file') &&
						tab.id !== targetId &&
						viewerPathsMatch(tab.path, path)
					),
			);
			return {
				tabs: upsertTab(tabs, {
					id: targetId,
					type: 'file',
					title: existingFile?.title ?? titleFromPath(targetPath),
					path: targetPath,
				}),
				activeTabId: targetId,
			};
		});
	},

	openToolReadTab: (path, highlight) => {
		const id = fileTabId(path);
		set((state) => {
			const matchingFileTabs = state.tabs.filter(
				(tab): tab is Extract<ViewerTab, { type: 'file' }> =>
					tab.type === 'file' && viewerPathsMatch(tab.path, path),
			);
			const existingFile =
				matchingFileTabs.find((tab) => tab.id === state.activeTabId) ??
				matchingFileTabs[0];
			const targetId = existingFile?.id ?? id;
			const targetPath = existingFile?.path ?? path;
			const tabs = state.tabs.filter(
				(tab) =>
					!(
						(tab.type === 'tool-preview' || tab.type === 'file') &&
						tab.id !== targetId &&
						viewerPathsMatch(tab.path, path)
					),
			);
			return {
				tabs: upsertTab(tabs, {
					id: targetId,
					type: 'file',
					title: existingFile?.title ?? titleFromPath(targetPath),
					path: targetPath,
					highlight,
					patchPreview: undefined,
					writePreview: undefined,
				}),
				activeTabId: targetId,
			};
		});
	},

	openToolPreviewTab: (preview) => {
		const id = fileTabId(preview.path);
		set((state) => {
			const matchingFileTabs = state.tabs.filter(
				(tab): tab is Extract<ViewerTab, { type: 'file' }> =>
					tab.type === 'file' && viewerPathsMatch(tab.path, preview.path),
			);
			const existingFile =
				matchingFileTabs.find((tab) => tab.id === state.activeTabId) ??
				matchingFileTabs[0];
			const targetId = existingFile?.id ?? id;
			const targetPath = existingFile?.path ?? preview.path;
			const existing = state.tabs.find(
				(tab): tab is Extract<ViewerTab, { type: 'tool-preview' }> =>
					tab.type === 'tool-preview' &&
					viewerPathsMatch(tab.path, preview.path),
			);
			const tabs = state.tabs.filter(
				(tab) =>
					!(
						(tab.type === 'tool-preview' || tab.type === 'file') &&
						tab.id !== targetId &&
						(viewerPathsMatch(tab.path, preview.path) ||
							Boolean(
								preview.callId &&
									'toolName' in tab &&
									tab.callId === preview.callId,
							))
					),
			);
			if (preview.toolName === 'apply_patch') {
				const existingPatchPreview =
					existingFile?.patchPreview ??
					(existing?.toolName === 'apply_patch' ? existing : undefined);
				const samePatchCall = isSamePatchCall(existingPatchPreview, preview);
				const baseContent =
					preview.baseContent ??
					(samePatchCall
						? existingPatchPreview?.baseContent
						: (existingPatchPreview?.resultContent ??
							existingPatchPreview?.baseContent));
				const changedLines = samePatchCall
					? (preview.changedLines ?? existingPatchPreview?.changedLines)
					: mergeChangedLines(
							existingPatchPreview?.changedLines,
							preview.changedLines,
						);
				return {
					tabs: upsertTab(tabs, {
						id: targetId,
						type: 'file',
						title: existingFile?.title ?? titleFromPath(targetPath),
						path: targetPath,
						highlight: undefined,
						writePreview: undefined,
						patchPreview: {
							path: targetPath,
							toolName: 'apply_patch',
							callId: preview.callId ?? existingPatchPreview?.callId,
							baseContent,
							patch: preview.patch ?? existingPatchPreview?.patch,
							changedLines,
							previewContent:
								preview.previewContent ??
								(samePatchCall
									? existingPatchPreview?.previewContent
									: undefined),
							resultContent:
								preview.resultContent ??
								(samePatchCall
									? existingPatchPreview?.resultContent
									: undefined),
							previewLineTones:
								preview.previewLineTones ??
								(samePatchCall
									? existingPatchPreview?.previewLineTones
									: undefined),
							previewFirstLine:
								preview.previewFirstLine ??
								(samePatchCall
									? existingPatchPreview?.previewFirstLine
									: undefined),
							previewLatestLine:
								preview.previewLatestLine ??
								(samePatchCall
									? existingPatchPreview?.previewLatestLine
									: undefined),
							status: preview.status,
							error: preview.error ?? existingPatchPreview?.error,
						},
					}),
					activeTabId: targetId,
				};
			}
			if (existingFile) {
				const existingWritePreview = existingFile.writePreview;
				return {
					tabs: upsertTab(tabs, {
						...existingFile,
						highlight: undefined,
						patchPreview: undefined,
						writePreview: {
							path: targetPath,
							toolName: 'write',
							callId: preview.callId ?? existingWritePreview?.callId,
							content: preview.content ?? existingWritePreview?.content,
							status: preview.status,
							error: preview.error ?? existingWritePreview?.error,
						},
					}),
					activeTabId: targetId,
				};
			}
			const existingWrite =
				existing?.toolName === 'write' ? existing : undefined;
			return {
				tabs: upsertTab(tabs, {
					id,
					type: 'tool-preview',
					title: titleFromPath(preview.path),
					path: preview.path,
					toolName: preview.toolName,
					callId: preview.callId,
					content: preview.content ?? existingWrite?.content,
					baseContent: undefined,
					patch: undefined,
					changedLines: undefined,
					previewContent: undefined,
					resultContent: undefined,
					previewLineTones: undefined,
					previewFirstLine: undefined,
					previewLatestLine: undefined,
					status: preview.status,
					error: preview.error ?? existingWrite?.error,
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
