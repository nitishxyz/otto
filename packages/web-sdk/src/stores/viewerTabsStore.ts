import { create } from 'zustand';
import type { SessionFileOperation } from '../types/api';

export interface ToolActivityHighlight {
	startLine?: number;
	endLine?: number;
	reason: 'read' | 'write' | 'apply_patch';
	callId?: string;
	status: 'streaming' | 'success' | 'error';
}

export interface ToolActivityAnnotation {
	id: string;
	reason: 'write' | 'apply_patch';
	callId?: string;
	status: 'streaming' | 'success' | 'error';
	lineTones: Array<[number, 'add' | 'remove']>;
	createdAt: number;
}

export interface ToolChangeCount {
	additions: number;
	removals: number;
}

export type ToolPatchPreviewName = 'apply_patch' | 'edit' | 'multiedit';

export interface ToolPreviewTabInput {
	path: string;
	toolName: 'write' | ToolPatchPreviewName;
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
	changeCount?: ToolChangeCount;
	status: 'streaming' | 'success' | 'error';
	error?: string;
}

export type ToolPatchPreview = Omit<
	ToolPreviewTabInput,
	'toolName' | 'content'
> & {
	toolName: ToolPatchPreviewName;
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
			annotations?: ToolActivityAnnotation[];
			patchPreview?: ToolPatchPreview;
			writePreview?: ToolWritePreview;
	  }
	| {
			id: string;
			type: 'tool-preview';
			title: string;
			path: string;
			toolName: 'write' | ToolPatchPreviewName;
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
			changeCount?: ToolChangeCount;
			status: 'streaming' | 'success' | 'error';
			error?: string;
	  }
	| {
			id: string;
			type: 'skill-file';
			title: string;
			skill: string;
			file: string | null;
	  }
	| {
			id: string;
			type: 'browser';
			title: string;
			url: string;
			kind: 'browser' | 'simulator';
			reloadKey: number;
	  };

export type ViewerMode = 'work' | 'preview';

interface ViewerTabsState {
	tabs: ViewerTab[];
	activeTabId: string | null;
	activeMode: ViewerMode;
	activeWorkTabId: string | null;
	activePreviewTabId: string | null;
	followToolActivity: boolean;
	toggleFollowToolActivity: () => void;
	setFollowToolActivity: (enabled: boolean) => void;
	setViewerMode: (mode: ViewerMode) => void;
	openGitDiffTab: (path: string, staged: boolean) => void;
	openSessionFileDiffTab: (
		path: string,
		operations: SessionFileOperation[],
	) => void;
	openFileTab: (path: string) => void;
	openToolReadTab: (path: string, highlight: ToolActivityHighlight) => void;
	openToolPreviewTab: (preview: ToolPreviewTabInput) => void;
	openSkillFileTab: (skill: string, file: string | null) => void;
	openBrowserTab: (
		url?: string,
		options?: {
			kind?: 'browser' | 'simulator';
			title?: string;
			newTab?: boolean;
		},
	) => void;
	updateBrowserTabUrl: (id: string, url: string) => void;
	reloadBrowserTab: (id: string) => void;
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

function browserTabId(kind: 'browser' | 'simulator'): string {
	return `browser:${kind}`;
}

function newBrowserTabId(): string {
	return `browser:browser:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function modeForTab(tab: ViewerTab): ViewerMode {
	return tab.type === 'browser' ? 'preview' : 'work';
}

function findFallbackTabId(
	tabs: ViewerTab[],
	mode: ViewerMode,
	closingIndex: number,
): string | null {
	const next = tabs.slice(closingIndex).find((tab) => modeForTab(tab) === mode);
	if (next) return next.id;
	const previous = [...tabs]
		.slice(0, closingIndex)
		.reverse()
		.find((tab) => modeForTab(tab) === mode);
	return previous?.id ?? null;
}

function activeIdForWorkUpdate(
	state: ViewerTabsState,
	targetId: string,
): string {
	return state.activeMode === 'preview' && state.activePreviewTabId
		? state.activePreviewTabId
		: targetId;
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

function isPatchPreviewTool(
	toolName: ToolPreviewTabInput['toolName'],
): toolName is ToolPatchPreviewName {
	return (
		toolName === 'apply_patch' ||
		toolName === 'edit' ||
		toolName === 'multiedit'
	);
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

function countContentLines(content: string): number {
	return content.length === 0 ? 1 : content.split('\n').length;
}

function annotationId(
	preview: ToolPreviewTabInput,
	targetPath: string,
): string {
	return `${preview.toolName}:${preview.callId ?? `${normalizeViewerPath(targetPath)}:${preview.patch ?? preview.content ?? ''}`}`;
}

function buildAnnotation(
	preview: ToolPreviewTabInput,
	targetPath: string,
	existing?: ToolActivityAnnotation,
): ToolActivityAnnotation | undefined {
	if (preview.status === 'error') return existing;
	const id = annotationId(preview, targetPath);
	if (preview.toolName === 'write') {
		const content = preview.content;
		if (content === undefined) return existing;
		return {
			id,
			reason: 'write',
			callId: preview.callId,
			status: preview.status,
			lineTones: Array.from(
				{ length: countContentLines(content) },
				(_, index) => [index + 1, 'add' as const],
			),
			createdAt: existing?.createdAt ?? Date.now(),
		};
	}

	const lineTones: Array<[number, 'add' | 'remove']> | undefined = preview
		.previewLineTones?.length
		? preview.previewLineTones
		: preview.changedLines?.length
			? preview.changedLines.map((line) => [line, 'add'])
			: existing?.lineTones;
	if (!lineTones?.length) return existing;
	return {
		id,
		reason: 'apply_patch',
		callId: preview.callId,
		status: preview.status,
		lineTones,
		createdAt: existing?.createdAt ?? Date.now(),
	};
}

function upsertAnnotation(
	annotations: ToolActivityAnnotation[] | undefined,
	annotation: ToolActivityAnnotation | undefined,
): ToolActivityAnnotation[] | undefined {
	if (!annotation) return annotations;
	const existing = annotations ?? [];
	const index = existing.findIndex((item) => item.id === annotation.id);
	if (index === -1) return [...existing, annotation];
	const next = [...existing];
	next[index] = annotation;
	return next;
}

export const useViewerTabsStore = create<ViewerTabsState>((set) => ({
	tabs: [],
	activeTabId: null,
	activeMode: 'work',
	activeWorkTabId: null,
	activePreviewTabId: null,
	followToolActivity: false,

	toggleFollowToolActivity: () =>
		set((state) => ({ followToolActivity: !state.followToolActivity })),

	setFollowToolActivity: (enabled) => set({ followToolActivity: enabled }),

	setViewerMode: (mode) =>
		set((state) => {
			const activeTabId =
				mode === 'preview' ? state.activePreviewTabId : state.activeWorkTabId;
			return {
				activeMode: mode,
				activeTabId: activeTabId ?? null,
			};
		}),

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
			activeMode: 'work',
			activeWorkTabId: id,
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
			activeMode: 'work',
			activeWorkTabId: id,
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
					highlight: existingFile?.highlight,
					annotations: existingFile?.annotations,
					patchPreview: existingFile?.patchPreview,
					writePreview: existingFile?.writePreview,
				}),
				activeMode: 'work',
				activeWorkTabId: targetId,
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
					annotations: existingFile?.annotations,
					patchPreview: undefined,
					writePreview: undefined,
				}),
				activeWorkTabId: targetId,
				activeTabId: activeIdForWorkUpdate(state, targetId),
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
			if (isPatchPreviewTool(preview.toolName)) {
				const existingPatchPreview =
					existingFile?.patchPreview ??
					(existing && isPatchPreviewTool(existing.toolName)
						? existing
						: undefined);
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
				const annotationPreview = {
					...preview,
					changedLines: preview.changedLines,
				};
				const existingAnnotation = existingFile?.annotations?.find(
					(annotation) =>
						annotation.id === annotationId(annotationPreview, targetPath),
				);
				const annotations = upsertAnnotation(
					existingFile?.annotations,
					buildAnnotation(annotationPreview, targetPath, existingAnnotation),
				);
				return {
					tabs: upsertTab(tabs, {
						id: targetId,
						type: 'file',
						title: existingFile?.title ?? titleFromPath(targetPath),
						path: targetPath,
						highlight: undefined,
						annotations,
						writePreview: undefined,
						patchPreview: {
							path: targetPath,
							toolName: preview.toolName,
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
					activeWorkTabId: targetId,
					activeTabId: activeIdForWorkUpdate(state, targetId),
				};
			}
			if (existingFile) {
				const existingWritePreview = existingFile.writePreview;
				const existingAnnotation = existingFile.annotations?.find(
					(annotation) => annotation.id === annotationId(preview, targetPath),
				);
				const annotations = upsertAnnotation(
					existingFile.annotations,
					buildAnnotation(preview, targetPath, existingAnnotation),
				);
				return {
					tabs: upsertTab(tabs, {
						...existingFile,
						highlight: undefined,
						annotations,
						patchPreview: undefined,
						writePreview: {
							path: targetPath,
							toolName: 'write',
							callId: preview.callId ?? existingWritePreview?.callId,
							content: preview.content ?? existingWritePreview?.content,
							changeCount:
								preview.changeCount ?? existingWritePreview?.changeCount,
							status: preview.status,
							error: preview.error ?? existingWritePreview?.error,
						},
					}),
					activeWorkTabId: targetId,
					activeTabId: activeIdForWorkUpdate(state, targetId),
				};
			}
			const existingWrite =
				existing?.toolName === 'write' ? existing : undefined;
			const annotation = buildAnnotation(preview, preview.path);
			return {
				tabs: upsertTab(tabs, {
					id,
					type: 'file',
					title: titleFromPath(preview.path),
					path: preview.path,
					highlight: undefined,
					annotations: annotation ? [annotation] : undefined,
					patchPreview: undefined,
					writePreview: {
						path: preview.path,
						toolName: 'write',
						callId: preview.callId,
						content: preview.content ?? existingWrite?.content,
						changeCount: preview.changeCount ?? existingWrite?.changeCount,
						status: preview.status,
						error: preview.error ?? existingWrite?.error,
					},
				}),
				activeWorkTabId: id,
				activeTabId: activeIdForWorkUpdate(state, id),
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
			activeMode: 'work',
			activeWorkTabId: id,
			activeTabId: id,
		}));
	},

	openBrowserTab: (url = '', options = {}) => {
		const kind = options.kind ?? 'browser';
		set((state) => {
			const shouldCreate = kind === 'browser' && options.newTab === true;
			const id = shouldCreate ? newBrowserTabId() : browserTabId(kind);
			const existing = state.tabs.find(
				(tab): tab is Extract<ViewerTab, { type: 'browser' }> =>
					!shouldCreate && tab.type === 'browser' && tab.id === id,
			);
			return {
				tabs: upsertTab(state.tabs, {
					id,
					type: 'browser',
					title: options.title ?? existing?.title ?? 'Browser',
					url: url || existing?.url || '',
					kind,
					reloadKey: existing?.reloadKey ?? 0,
				}),
				activeMode: 'preview',
				activePreviewTabId: id,
				activeTabId: id,
			};
		});
	},

	updateBrowserTabUrl: (id, url) =>
		set((state) => ({
			tabs: state.tabs.map((tab) =>
				tab.id === id && tab.type === 'browser'
					? {
							...tab,
							url,
							title: tab.kind === 'simulator' ? 'Simulator' : 'Browser',
						}
					: tab,
			),
		})),

	reloadBrowserTab: (id) =>
		set((state) => ({
			tabs: state.tabs.map((tab) =>
				tab.id === id && tab.type === 'browser'
					? { ...tab, reloadKey: tab.reloadKey + 1 }
					: tab,
			),
		})),

	setActiveTab: (id) =>
		set((state) => {
			const tab = state.tabs.find((item) => item.id === id);
			const mode = tab ? modeForTab(tab) : state.activeMode;
			return {
				activeMode: mode,
				activeWorkTabId: mode === 'work' ? id : state.activeWorkTabId,
				activePreviewTabId: mode === 'preview' ? id : state.activePreviewTabId,
				activeTabId: id,
			};
		}),

	closeTab: (id) =>
		set((state) => {
			const closingIndex = state.tabs.findIndex((tab) => tab.id === id);
			const closingTab = state.tabs[closingIndex];
			const tabs = state.tabs.filter((tab) => tab.id !== id);
			let activeMode = state.activeMode;
			let activeWorkTabId = state.activeWorkTabId;
			let activePreviewTabId = state.activePreviewTabId;

			if (
				closingTab &&
				modeForTab(closingTab) === 'work' &&
				activeWorkTabId === id
			) {
				activeWorkTabId = findFallbackTabId(tabs, 'work', closingIndex);
			}

			if (
				closingTab &&
				modeForTab(closingTab) === 'preview' &&
				activePreviewTabId === id
			) {
				activePreviewTabId = findFallbackTabId(tabs, 'preview', closingIndex);
			}

			if (activeMode === 'work' && !activeWorkTabId && activePreviewTabId) {
				activeMode = 'preview';
			}

			if (activeMode === 'preview' && !activePreviewTabId && activeWorkTabId) {
				activeMode = 'work';
			}

			return {
				tabs,
				activeMode,
				activeWorkTabId,
				activePreviewTabId,
				activeTabId:
					activeMode === 'preview' ? activePreviewTabId : activeWorkTabId,
			};
		}),

	updateSessionFileOperationIndex: (id, index) =>
		set((state) => ({
			tabs: state.tabs.map((tab) =>
				tab.id === id && tab.type === 'session-file-diff'
					? { ...tab, selectedOperationIndex: index }
					: tab,
			),
		})),

	closeAllTabs: () =>
		set({
			tabs: [],
			activeTabId: null,
			activeMode: 'work',
			activeWorkTabId: null,
			activePreviewTabId: null,
		}),
}));
