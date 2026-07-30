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
	lineTones?: Array<[number, 'add' | 'remove']>;
	lineToneRanges?: LineToneRange[];
	createdAt: number;
}

export interface ToolChangeCount {
	additions: number;
	removals: number;
}

export interface LineToneRange {
	from: number;
	to: number;
	tone: 'add' | 'remove';
}

export type ToolPatchPreviewName = 'apply_patch' | 'edit' | 'multiedit';

export interface ToolPreviewTabInput {
	path: string;
	toolName: 'write' | ToolPatchPreviewName;
	callId?: string;
	content?: string;
	baseContent?: string;
	baseContentHash?: string;
	baseContentCacheKey?: string;
	patch?: string;
	changedLines?: number[];
	previewContent?: string;
	previewContentHash?: string;
	previewContentCacheKey?: string;
	resultContent?: string;
	resultContentHash?: string;
	resultContentCacheKey?: string;
	previewLineTones?: Array<[number, 'add' | 'remove']>;
	previewLineToneRanges?: LineToneRange[];
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
	| 'baseContentHash'
	| 'baseContentCacheKey'
	| 'patch'
	| 'changedLines'
	| 'previewContent'
	| 'previewContentHash'
	| 'previewContentCacheKey'
	| 'resultContent'
	| 'resultContentHash'
	| 'resultContentCacheKey'
	| 'previewLineTones'
	| 'previewLineToneRanges'
	| 'previewFirstLine'
	| 'previewLatestLine'
> & {
	toolName: 'write';
};

const MAX_FOLLOW_CREATED_TABS = 10;
const MAX_STORED_LINE_TONES = 500;
const MAX_PATCH_PREVIEW_BODY_CACHE_ENTRIES = 24;

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
			createdBy?: 'user' | 'follow';
			pinned?: boolean;
			lastAccessedAt?: number;
			highlight?: ToolActivityHighlight;
			annotations?: ToolActivityAnnotation[];
			patchPreview?: ToolPatchPreview;
			writePreview?: ToolWritePreview;
	  }
	| {
			id: string;
			type: 'agent-activity';
			title: string;
			path: string;
			lastAccessedAt?: number;
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
			baseContentHash?: string;
			baseContentCacheKey?: string;
			patch?: string;
			changedLines?: number[];
			previewContent?: string;
			previewContentHash?: string;
			previewContentCacheKey?: string;
			resultContent?: string;
			resultContentHash?: string;
			resultContentCacheKey?: string;
			previewLineTones?: Array<[number, 'add' | 'remove']>;
			previewLineToneRanges?: LineToneRange[];
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
	  }
	| {
			id: string;
			type: 'terminal';
			title: string;
			terminalId: string;
	  };

export type ViewerMode = 'work' | 'preview' | 'terminal';

export interface ViewerTabPayloadCache {
	patchPreviews: Record<string, ToolPatchPreview | undefined>;
	writePreviews: Record<string, ToolWritePreview | undefined>;
}

export interface ViewerTurnFileChange {
	baselineContent: string;
	latestContent: string;
}

export interface ViewerTabsState {
	tabs: ViewerTab[];
	tabOrder: string[];
	tabsById: Record<string, ViewerTab | undefined>;
	tabPayloads: ViewerTabPayloadCache;
	turnFileChanges: Record<string, ViewerTurnFileChange | undefined>;
	markdownPreviewPaths: Record<string, boolean | undefined>;
	activeTabId: string | null;
	activeMode: ViewerMode;
	activeWorkTabId: string | null;
	activePreviewTabId: string | null;
	activeTerminalTabId: string | null;
	followToolActivity: boolean;
	followReadActivity: boolean;
	toggleFollowToolActivity: () => void;
	toggleFollowReadActivity: () => void;
	setFollowToolActivity: (enabled: boolean) => void;
	setFollowReadActivity: (enabled: boolean) => void;
	setViewerMode: (mode: ViewerMode) => void;
	openGitDiffTab: (path: string, staged: boolean) => void;
	openSessionFileDiffTab: (
		path: string,
		operations: SessionFileOperation[],
	) => void;
	openFileTab: (path: string) => void;
	openToolReadTab: (path: string, highlight: ToolActivityHighlight) => void;
	openToolPreviewTab: (preview: ToolPreviewTabInput) => void;
	resetFollowTurnChanges: () => void;
	setMarkdownPreviewEnabled: (path: string, enabled: boolean) => void;
	openSkillFileTab: (skill: string, file: string | null) => void;
	openBrowserTab: (
		url?: string,
		options?: {
			id?: string;
			kind?: 'browser' | 'simulator';
			title?: string;
			newTab?: boolean;
		},
	) => void;
	openTerminalTab: (terminalId: string, title?: string) => void;
	syncTerminalTabs: (terminals: Array<{ id: string; title: string }>) => void;
	updateBrowserTabUrl: (id: string, url: string) => void;
	reloadBrowserTab: (id: string) => void;
	toggleFileTabPinned: (id: string) => void;
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

function agentActivityTabId(path: string): string {
	return `agent-activity:${normalizeViewerPath(path)}`;
}

function browserTabId(kind: 'browser' | 'simulator'): string {
	return `browser:${kind}`;
}

function newBrowserTabId(): string {
	return `browser:browser:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

/** Deterministic viewer tab id for a daemon terminal. */
export function terminalViewerTabId(terminalId: string): string {
	return `terminal:${terminalId}`;
}

/**
 * Cancelable window CustomEvent asking the viewer to close its active tab.
 * Dispatchers should treat a `false` return from `window.dispatchEvent` (i.e.
 * defaultPrevented) as "a tab consumed the close"; otherwise no tab was open
 * and the host may close the window itself.
 */
export const VIEWER_CLOSE_ACTIVE_TAB_EVENT = 'otto-viewer:close-active-tab';

export function modeForViewerTab(tab: ViewerTab): ViewerMode {
	if (tab.type === 'browser') return 'preview';
	if (tab.type === 'terminal') return 'terminal';
	return 'work';
}

const modeForTab = modeForViewerTab;

function activeIdForMode(
	state: Pick<
		ViewerTabsState,
		'activeWorkTabId' | 'activePreviewTabId' | 'activeTerminalTabId'
	>,
	mode: ViewerMode,
): string | null {
	if (mode === 'preview') return state.activePreviewTabId;
	if (mode === 'terminal') return state.activeTerminalTabId;
	return state.activeWorkTabId;
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
	if (state.activeMode === 'work') return targetId;
	return activeIdForMode(state, state.activeMode) ?? targetId;
}

function indexTabs(
	tabs: ViewerTab[],
): Pick<ViewerTabsState, 'tabOrder' | 'tabsById'> {
	return {
		tabOrder: tabs.map((tab) => tab.id),
		tabsById: Object.fromEntries(tabs.map((tab) => [tab.id, tab])),
	};
}

function tabsState(
	tabs: ViewerTab[],
): Pick<ViewerTabsState, 'tabs' | 'tabOrder' | 'tabsById'> {
	return {
		tabs,
		...indexTabs(tabs),
	};
}

export function hydrateViewerTab(
	tab: ViewerTab | undefined,
	payloads: ViewerTabPayloadCache,
): ViewerTab | undefined {
	if (!tab) return undefined;
	if (tab.type === 'file' || tab.type === 'agent-activity') {
		return {
			...tab,
			patchPreview: payloads.patchPreviews[tab.id] ?? tab.patchPreview,
			writePreview: payloads.writePreviews[tab.id] ?? tab.writePreview,
		};
	}
	if (tab.type === 'tool-preview') {
		const patchPreview = payloads.patchPreviews[tab.id];
		if (patchPreview) return { ...tab, ...patchPreview };
		const writePreview = payloads.writePreviews[tab.id];
		if (writePreview) return { ...tab, ...writePreview };
	}
	return tab;
}

export function getHydratedViewerTab(
	state: ViewerTabsState,
	id: string | null,
): ViewerTab | undefined {
	return id
		? hydrateViewerTab(state.tabsById[id], state.tabPayloads)
		: undefined;
}

export function getHydratedViewerTabs(state: ViewerTabsState): ViewerTab[] {
	return state.tabOrder
		.map((id) => hydrateViewerTab(state.tabsById[id], state.tabPayloads))
		.filter((tab): tab is ViewerTab => Boolean(tab));
}

function withoutTabPayloads(
	payloads: ViewerTabPayloadCache,
	ids: Iterable<string>,
): ViewerTabPayloadCache {
	const removedIds = new Set(ids);
	return {
		patchPreviews: Object.fromEntries(
			Object.entries(payloads.patchPreviews).filter(
				([id]) => !removedIds.has(id),
			),
		),
		writePreviews: Object.fromEntries(
			Object.entries(payloads.writePreviews).filter(
				([id]) => !removedIds.has(id),
			),
		),
	};
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

function capFollowCreatedTabs(tabs: ViewerTab[]): ViewerTab[] {
	const candidates = tabs
		.filter(
			(tab): tab is Extract<ViewerTab, { type: 'agent-activity' }> =>
				tab.type === 'agent-activity',
		)
		.sort(
			(left, right) => (left.lastAccessedAt ?? 0) - (right.lastAccessedAt ?? 0),
		);
	const overflow = candidates.length - MAX_FOLLOW_CREATED_TABS;
	if (overflow <= 0) return tabs;

	const evictedIds = new Set(
		candidates.slice(0, overflow).map((tab) => tab.id),
	);
	return tabs.filter((tab) => !evictedIds.has(tab.id));
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

function isWritePreviewTool(
	tab: Extract<ViewerTab, { type: 'tool-preview' }> | undefined,
): tab is Extract<ViewerTab, { type: 'tool-preview' }> & ToolWritePreview {
	return tab?.toolName === 'write';
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

export function hashViewerText(
	content: string | undefined,
): string | undefined {
	if (content === undefined) return undefined;
	let hash = 5381;
	for (let index = 0; index < content.length; index += 1) {
		hash = (hash * 33) ^ content.charCodeAt(index);
	}
	return `${content.length}:${(hash >>> 0).toString(36)}`;
}

interface PatchPreviewBodyCacheEntry {
	baseContent?: string;
	previewContent?: string;
	resultContent?: string;
	updatedAt: number;
}

const patchPreviewBodyCache = new Map<string, PatchPreviewBodyCacheEntry>();

function getPatchPreviewBodyCacheKey(input: {
	path: string;
	callId?: string;
	patch?: string;
	baseContentHash?: string;
}): string {
	return [
		normalizeViewerPath(input.path),
		input.callId ?? 'no-call',
		hashViewerText(input.patch) ?? 'no-patch',
		input.baseContentHash ?? 'no-base',
	].join('|');
}

function prunePatchPreviewBodyCache() {
	if (patchPreviewBodyCache.size <= MAX_PATCH_PREVIEW_BODY_CACHE_ENTRIES)
		return;
	const entries = [...patchPreviewBodyCache.entries()].sort(
		(left, right) => left[1].updatedAt - right[1].updatedAt,
	);
	for (const [key] of entries.slice(
		0,
		patchPreviewBodyCache.size - MAX_PATCH_PREVIEW_BODY_CACHE_ENTRIES,
	)) {
		patchPreviewBodyCache.delete(key);
	}
}

function cachePatchPreviewBodies(
	key: string,
	entry: Omit<PatchPreviewBodyCacheEntry, 'updatedAt'>,
) {
	const existing = patchPreviewBodyCache.get(key);
	patchPreviewBodyCache.set(key, {
		baseContent: entry.baseContent ?? existing?.baseContent,
		previewContent: entry.previewContent ?? existing?.previewContent,
		resultContent: entry.resultContent ?? existing?.resultContent,
		updatedAt: Date.now(),
	});
	prunePatchPreviewBodyCache();
}

export function resolvePatchPreviewBodies(
	preview: Pick<
		ToolPatchPreview,
		| 'baseContent'
		| 'baseContentCacheKey'
		| 'previewContent'
		| 'previewContentCacheKey'
		| 'resultContent'
		| 'resultContentCacheKey'
	>,
): {
	baseContent?: string;
	previewContent?: string;
	resultContent?: string;
} {
	const baseEntry = preview.baseContentCacheKey
		? patchPreviewBodyCache.get(preview.baseContentCacheKey)
		: undefined;
	const previewEntry = preview.previewContentCacheKey
		? patchPreviewBodyCache.get(preview.previewContentCacheKey)
		: undefined;
	const resultEntry = preview.resultContentCacheKey
		? patchPreviewBodyCache.get(preview.resultContentCacheKey)
		: undefined;
	return {
		baseContent: preview.baseContent ?? baseEntry?.baseContent,
		previewContent: preview.previewContent ?? previewEntry?.previewContent,
		resultContent: preview.resultContent ?? resultEntry?.resultContent,
	};
}

export function lineToneEntriesToRanges(
	lineTones: Array<[number, 'add' | 'remove']> | undefined,
): LineToneRange[] | undefined {
	if (!lineTones?.length) return undefined;
	const sorted = [...lineTones].sort((left, right) => left[0] - right[0]);
	const ranges: LineToneRange[] = [];
	for (const [line, tone] of sorted) {
		if (line <= 0) continue;
		const previous = ranges.at(-1);
		if (previous && previous.tone === tone && previous.to + 1 === line) {
			previous.to = line;
			continue;
		}
		ranges.push({ from: line, to: line, tone });
	}
	return ranges.length > 0 ? ranges : undefined;
}

function compactLineTones(
	lineTones: Array<[number, 'add' | 'remove']> | undefined,
	lineToneRanges: LineToneRange[] | undefined,
): Pick<ToolActivityAnnotation, 'lineTones' | 'lineToneRanges'> {
	if (lineToneRanges?.length) return { lineToneRanges };
	if (!lineTones?.length) return {};
	if (lineTones.length > MAX_STORED_LINE_TONES) {
		return { lineToneRanges: lineToneEntriesToRanges(lineTones) };
	}
	return { lineTones };
}

function compactPreviewLineTones(
	lineTones: Array<[number, 'add' | 'remove']> | undefined,
	lineToneRanges: LineToneRange[] | undefined,
): Pick<ToolPatchPreview, 'previewLineTones' | 'previewLineToneRanges'> {
	if (lineToneRanges?.length) return { previewLineToneRanges: lineToneRanges };
	if (!lineTones?.length) return {};
	if (lineTones.length > MAX_STORED_LINE_TONES) {
		return { previewLineToneRanges: lineToneEntriesToRanges(lineTones) };
	}
	return { previewLineTones: lineTones };
}

function compactPreviewContent(
	content: string | undefined,
	existingContent: string | undefined,
): Pick<ToolPatchPreview, 'previewContentHash'> {
	if (content === undefined) {
		return {
			previewContentHash: hashViewerText(existingContent),
		};
	}
	return {
		previewContentHash: hashViewerText(content),
	};
}

function compactResultContent(
	content: string | undefined,
	existingContent: string | undefined,
): Pick<ToolPatchPreview, 'resultContentHash'> {
	if (content === undefined) {
		return {
			resultContentHash: hashViewerText(existingContent),
		};
	}
	return {
		resultContentHash: hashViewerText(content),
	};
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
		const lineCount = countContentLines(content);
		return {
			id,
			reason: 'write',
			callId: preview.callId,
			status: preview.status,
			...compactLineTones(
				lineCount > MAX_STORED_LINE_TONES
					? undefined
					: Array.from({ length: lineCount }, (_, index) => [
							index + 1,
							'add' as const,
						]),
				lineCount > MAX_STORED_LINE_TONES
					? [{ from: 1, to: lineCount, tone: 'add' }]
					: undefined,
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
	const lineToneRanges =
		preview.previewLineToneRanges ?? existing?.lineToneRanges;
	if (!lineTones?.length && !lineToneRanges?.length) return existing;
	return {
		id,
		reason: 'apply_patch',
		callId: preview.callId,
		status: preview.status,
		...compactLineTones(lineTones, lineToneRanges),
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

function replaceCurrentAnnotation(
	annotation: ToolActivityAnnotation | undefined,
): ToolActivityAnnotation[] | undefined {
	return annotation ? [annotation] : undefined;
}

function resolveWriteBaselineContent(input: {
	turnChange?: ViewerTurnFileChange;
	existingPatchPreview?: ToolPatchPreview;
	existingWritePreview?: ToolWritePreview;
}): string | undefined {
	if (input.turnChange) return input.turnChange.baselineContent;
	if (input.existingPatchPreview) {
		const bodies = resolvePatchPreviewBodies(input.existingPatchPreview);
		return (
			bodies.resultContent ??
			bodies.previewContent ??
			bodies.baseContent ??
			input.existingWritePreview?.content
		);
	}
	return input.existingWritePreview?.content;
}

function resolvePatchLatestContent(input: {
	preview: ToolPreviewTabInput;
	existingBodies: ReturnType<typeof resolvePatchPreviewBodies>;
	samePatchCall: boolean;
}): string | undefined {
	return (
		input.preview.resultContent ??
		input.preview.previewContent ??
		(input.samePatchCall
			? (input.existingBodies.resultContent ??
				input.existingBodies.previewContent)
			: undefined)
	);
}

function updateTurnFileChange(input: {
	turnFileChanges: ViewerTabsState['turnFileChanges'];
	path: string;
	baselineContent?: string;
	latestContent?: string;
}): {
	turnFileChanges: ViewerTabsState['turnFileChanges'];
	turnChange?: ViewerTurnFileChange;
	netUnchanged: boolean;
} {
	const key = normalizeViewerPath(input.path);
	const existing = input.turnFileChanges[key];
	const baselineContent = existing?.baselineContent ?? input.baselineContent;
	const latestContent = input.latestContent;
	if (baselineContent === undefined || latestContent === undefined) {
		return {
			turnFileChanges: input.turnFileChanges,
			turnChange: existing,
			netUnchanged: false,
		};
	}
	const turnChange = { baselineContent, latestContent };
	return {
		turnFileChanges: {
			...input.turnFileChanges,
			[key]: turnChange,
		},
		turnChange,
		netUnchanged: latestContent === baselineContent,
	};
}

export const useViewerTabsStore = create<ViewerTabsState>((set) => ({
	tabs: [],
	tabOrder: [],
	tabsById: {},
	tabPayloads: {
		patchPreviews: {},
		writePreviews: {},
	},
	turnFileChanges: {},
	markdownPreviewPaths: {},
	activeTabId: null,
	activeMode: 'work',
	activeWorkTabId: null,
	activePreviewTabId: null,
	activeTerminalTabId: null,
	followToolActivity: false,
	followReadActivity: false,

	toggleFollowToolActivity: () =>
		set((state) => ({ followToolActivity: !state.followToolActivity })),
	toggleFollowReadActivity: () =>
		set((state) => ({ followReadActivity: !state.followReadActivity })),

	setFollowToolActivity: (enabled) => set({ followToolActivity: enabled }),
	setFollowReadActivity: (enabled) => set({ followReadActivity: enabled }),

	setViewerMode: (mode) =>
		set((state) => ({
			activeMode: mode,
			activeTabId: activeIdForMode(state, mode) ?? null,
		})),

	openGitDiffTab: (path, staged) => {
		const id = `git-diff:${staged ? 'staged' : 'unstaged'}:${path}`;
		set((state) => ({
			...tabsState(
				upsertTab(state.tabs, {
					id,
					type: 'git-diff',
					title: titleFromPath(path),
					path,
					staged,
				}),
			),
			activeMode: 'work',
			activeWorkTabId: id,
			activeTabId: id,
		}));
	},

	openSessionFileDiffTab: (path, operations) => {
		const id = `session-file-diff:${path}`;
		set((state) => ({
			...tabsState(
				upsertTab(state.tabs, {
					id,
					type: 'session-file-diff',
					title: titleFromPath(path),
					path,
					operations,
					selectedOperationIndex: Math.max(0, operations.length - 1),
				}),
			),
			activeMode: 'work',
			activeWorkTabId: id,
			activeTabId: id,
		}));
	},

	openFileTab: (path) => {
		const id = fileTabId(path);
		set((state) => {
			const now = Date.now();
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
				...tabsState(
					upsertTab(tabs, {
						id: targetId,
						type: 'file',
						title: existingFile?.title ?? titleFromPath(targetPath),
						path: targetPath,
						createdBy: 'user',
						pinned: existingFile?.pinned,
						lastAccessedAt: now,
						highlight: existingFile?.highlight,
						annotations: existingFile?.annotations,
						patchPreview: existingFile?.patchPreview,
						writePreview: existingFile?.writePreview,
					}),
				),
				activeMode: 'work',
				activeWorkTabId: targetId,
				activeTabId: targetId,
			};
		});
	},

	openToolReadTab: (path, highlight) => {
		const id = agentActivityTabId(path);
		set((state) => {
			const now = Date.now();
			const existingActivity = state.tabs.find(
				(tab): tab is Extract<ViewerTab, { type: 'agent-activity' }> =>
					tab.type === 'agent-activity' && viewerPathsMatch(tab.path, path),
			);
			const targetId = existingActivity?.id ?? id;
			const targetPath = existingActivity?.path ?? path;
			const tabs = state.tabs.filter(
				(tab) =>
					!(
						(tab.type === 'tool-preview' || tab.type === 'agent-activity') &&
						tab.id !== targetId &&
						viewerPathsMatch(tab.path, path)
					),
			);
			const nextTabs = capFollowCreatedTabs(
				upsertTab(tabs, {
					id: targetId,
					type: 'agent-activity',
					title: existingActivity?.title ?? titleFromPath(targetPath),
					path: targetPath,
					lastAccessedAt: now,
					highlight,
					annotations: existingActivity?.annotations,
					patchPreview: undefined,
					writePreview: undefined,
				}),
			);
			const removedIds = new Set(
				state.tabs
					.map((tab) => tab.id)
					.filter((tabId) => !nextTabs.some((tab) => tab.id === tabId)),
			);
			const retainedPayloads = withoutTabPayloads(
				state.tabPayloads,
				removedIds,
			);
			return {
				...tabsState(nextTabs),
				tabPayloads: {
					patchPreviews: {
						...retainedPayloads.patchPreviews,
						[targetId]: undefined,
					},
					writePreviews: {
						...retainedPayloads.writePreviews,
						[targetId]: undefined,
					},
				},
				activeWorkTabId: targetId,
				activeTabId: activeIdForWorkUpdate(state, targetId),
			};
		});
	},

	openToolPreviewTab: (preview) => {
		const id = agentActivityTabId(preview.path);
		set((state) => {
			const now = Date.now();
			let nextTurnFileChanges = state.turnFileChanges;
			const existingActivity = state.tabs.find(
				(tab): tab is Extract<ViewerTab, { type: 'agent-activity' }> =>
					tab.type === 'agent-activity' &&
					viewerPathsMatch(tab.path, preview.path),
			);
			const targetId = existingActivity?.id ?? id;
			const targetPath = existingActivity?.path ?? preview.path;
			const existing = state.tabs.find(
				(tab): tab is Extract<ViewerTab, { type: 'tool-preview' }> =>
					tab.type === 'tool-preview' &&
					viewerPathsMatch(tab.path, preview.path),
			);
			const tabs = state.tabs.filter(
				(tab) =>
					!(
						(tab.type === 'tool-preview' || tab.type === 'agent-activity') &&
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
					state.tabPayloads.patchPreviews[targetId] ??
					existingActivity?.patchPreview ??
					(existing && isPatchPreviewTool(existing.toolName)
						? existing
						: undefined);
				const existingBodies = existingPatchPreview
					? resolvePatchPreviewBodies(existingPatchPreview)
					: {};
				const samePatchCall = isSamePatchCall(existingPatchPreview, preview);
				const compactPreview = compactPreviewContent(
					preview.previewContent,
					samePatchCall ? existingBodies.previewContent : undefined,
				);
				const compactResult = compactResultContent(
					preview.resultContent,
					samePatchCall ? existingBodies.resultContent : undefined,
				);
				const compactTones = compactPreviewLineTones(
					preview.previewLineTones ??
						(samePatchCall
							? existingPatchPreview?.previewLineTones
							: undefined),
					preview.previewLineToneRanges ??
						(samePatchCall
							? existingPatchPreview?.previewLineToneRanges
							: undefined),
				);
				const baseContent = preview.baseContent ?? existingBodies.baseContent;
				const baseContentHash = hashViewerText(baseContent);
				const turnChangeResult =
					preview.status === 'success'
						? updateTurnFileChange({
								turnFileChanges: state.turnFileChanges,
								path: targetPath,
								baselineContent: baseContent,
								latestContent: resolvePatchLatestContent({
									preview,
									existingBodies,
									samePatchCall,
								}),
							})
						: undefined;
				nextTurnFileChanges =
					turnChangeResult?.turnFileChanges ?? nextTurnFileChanges;
				const bodyCacheKey = getPatchPreviewBodyCacheKey({
					path: targetPath,
					callId: preview.callId ?? existingPatchPreview?.callId,
					patch: turnChangeResult?.netUnchanged
						? undefined
						: (preview.patch ?? existingPatchPreview?.patch),
					baseContentHash: turnChangeResult?.turnChange
						? hashViewerText(turnChangeResult.turnChange.baselineContent)
						: baseContentHash,
				});
				const effectiveBaseContent =
					turnChangeResult?.turnChange?.baselineContent ?? baseContent;
				const effectiveLatestContent =
					turnChangeResult?.turnChange?.latestContent ??
					preview.resultContent ??
					preview.previewContent ??
					(samePatchCall ? existingBodies.resultContent : undefined);
				cachePatchPreviewBodies(bodyCacheKey, {
					baseContent: effectiveBaseContent,
					previewContent:
						effectiveLatestContent ??
						preview.previewContent ??
						(samePatchCall ? existingBodies.previewContent : undefined),
					resultContent:
						effectiveLatestContent ??
						preview.resultContent ??
						(samePatchCall ? existingBodies.resultContent : undefined),
				});
				const changedLines = samePatchCall
					? (preview.changedLines ?? existingPatchPreview?.changedLines)
					: mergeChangedLines(
							existingPatchPreview?.changedLines,
							preview.changedLines,
						);
				const shouldClearNetPreview = turnChangeResult?.netUnchanged === true;
				const shouldShowOperationPreview =
					preview.status === 'streaming' ||
					(preview.status === 'success' && !shouldClearNetPreview);
				const patchPreview: ToolPatchPreview = {
					path: targetPath,
					toolName: preview.toolName,
					callId: preview.callId ?? existingPatchPreview?.callId,
					baseContent: undefined,
					baseContentHash: hashViewerText(effectiveBaseContent),
					baseContentCacheKey: bodyCacheKey,
					patch: shouldClearNetPreview
						? undefined
						: (preview.patch ?? existingPatchPreview?.patch),
					changedLines: shouldClearNetPreview ? undefined : changedLines,
					...(shouldClearNetPreview
						? { previewContentHash: hashViewerText(effectiveLatestContent) }
						: compactPreview),
					previewContent: undefined,
					previewContentCacheKey: bodyCacheKey,
					...(shouldClearNetPreview
						? { resultContentHash: hashViewerText(effectiveLatestContent) }
						: compactResult),
					resultContent: undefined,
					resultContentCacheKey: bodyCacheKey,
					...(shouldClearNetPreview ? {} : compactTones),
					previewFirstLine: shouldClearNetPreview
						? undefined
						: (preview.previewFirstLine ??
							(samePatchCall
								? existingPatchPreview?.previewFirstLine
								: undefined)),
					previewLatestLine: shouldClearNetPreview
						? undefined
						: (preview.previewLatestLine ??
							(samePatchCall
								? existingPatchPreview?.previewLatestLine
								: undefined)),
					status: preview.status,
					error: preview.error ?? existingPatchPreview?.error,
				};
				const nextTabs = capFollowCreatedTabs(
					upsertTab(tabs, {
						id: targetId,
						type: 'agent-activity',
						title: existingActivity?.title ?? titleFromPath(targetPath),
						path: targetPath,
						lastAccessedAt: now,
						highlight: undefined,
						annotations: undefined,
						writePreview: undefined,
						patchPreview: undefined,
					}),
				);
				const removedIds = new Set(
					state.tabs
						.map((tab) => tab.id)
						.filter((tabId) => !nextTabs.some((tab) => tab.id === tabId)),
				);
				const retainedPayloads = withoutTabPayloads(
					state.tabPayloads,
					removedIds,
				);
				return {
					...tabsState(nextTabs),
					tabPayloads: {
						patchPreviews: {
							...retainedPayloads.patchPreviews,
							[targetId]: shouldShowOperationPreview ? patchPreview : undefined,
						},
						writePreviews: {
							...retainedPayloads.writePreviews,
							[targetId]: undefined,
						},
					},
					turnFileChanges: nextTurnFileChanges,
					activeWorkTabId: targetId,
					activeTabId: activeIdForWorkUpdate(state, targetId),
				};
			}
			if (existingActivity) {
				const existingWritePreview =
					state.tabPayloads.writePreviews[targetId] ??
					existingActivity.writePreview;
				const existingPatchPreview =
					state.tabPayloads.patchPreviews[targetId] ??
					existingActivity.patchPreview;
				const turnChangeResult =
					preview.status === 'success'
						? updateTurnFileChange({
								turnFileChanges: state.turnFileChanges,
								path: targetPath,
								baselineContent: resolveWriteBaselineContent({
									turnChange:
										state.turnFileChanges[normalizeViewerPath(targetPath)],
									existingPatchPreview,
									existingWritePreview,
								}),
								latestContent: preview.content ?? existingWritePreview?.content,
							})
						: undefined;
				nextTurnFileChanges =
					turnChangeResult?.turnFileChanges ?? nextTurnFileChanges;
				const existingAnnotation = existingActivity.annotations?.find(
					(annotation) => annotation.id === annotationId(preview, targetPath),
				);
				const sameWriteCall = Boolean(
					preview.callId && existingWritePreview?.callId === preview.callId,
				);
				const annotations = sameWriteCall
					? upsertAnnotation(
							existingActivity.annotations,
							buildAnnotation(preview, targetPath, existingAnnotation),
						)
					: replaceCurrentAnnotation(
							buildAnnotation(preview, targetPath, existingAnnotation),
						);
				const writePreview: ToolWritePreview = {
					path: targetPath,
					toolName: 'write',
					callId: preview.callId ?? existingWritePreview?.callId,
					content: preview.content ?? existingWritePreview?.content,
					changeCount: preview.changeCount ?? existingWritePreview?.changeCount,
					status: preview.status,
					error: preview.error ?? existingWritePreview?.error,
				};
				const shouldClearNetPreview = turnChangeResult?.netUnchanged === true;
				const shouldShowOperationPreview =
					preview.status === 'streaming' ||
					(preview.status === 'success' && !shouldClearNetPreview);
				const nextTabs = capFollowCreatedTabs(
					upsertTab(tabs, {
						...existingActivity,
						lastAccessedAt: now,
						highlight: undefined,
						annotations:
							shouldShowOperationPreview && !shouldClearNetPreview
								? annotations
								: undefined,
						patchPreview: undefined,
						writePreview: undefined,
					}),
				);
				const removedIds = new Set(
					state.tabs
						.map((tab) => tab.id)
						.filter((tabId) => !nextTabs.some((tab) => tab.id === tabId)),
				);
				const retainedPayloads = withoutTabPayloads(
					state.tabPayloads,
					removedIds,
				);
				return {
					...tabsState(nextTabs),
					tabPayloads: {
						patchPreviews: {
							...retainedPayloads.patchPreviews,
							[targetId]: undefined,
						},
						writePreviews: {
							...retainedPayloads.writePreviews,
							[targetId]: shouldShowOperationPreview ? writePreview : undefined,
						},
					},
					turnFileChanges: nextTurnFileChanges,
					activeWorkTabId: targetId,
					activeTabId: activeIdForWorkUpdate(state, targetId),
				};
			}
			const existingWrite =
				state.tabPayloads.writePreviews[id] ??
				(isWritePreviewTool(existing) ? existing : undefined);
			const turnChangeResult =
				preview.status === 'success'
					? updateTurnFileChange({
							turnFileChanges: state.turnFileChanges,
							path: preview.path,
							baselineContent: resolveWriteBaselineContent({
								turnChange:
									state.turnFileChanges[normalizeViewerPath(preview.path)],
								existingWritePreview: existingWrite,
							}),
							latestContent: preview.content ?? existingWrite?.content,
						})
					: undefined;
			nextTurnFileChanges =
				turnChangeResult?.turnFileChanges ?? nextTurnFileChanges;
			const annotation = buildAnnotation(preview, preview.path);
			const writePreview: ToolWritePreview = {
				path: preview.path,
				toolName: 'write',
				callId: preview.callId,
				content: preview.content ?? existingWrite?.content,
				changeCount: preview.changeCount ?? existingWrite?.changeCount,
				status: preview.status,
				error: preview.error ?? existingWrite?.error,
			};
			const shouldClearNetPreview = turnChangeResult?.netUnchanged === true;
			const shouldShowOperationPreview =
				preview.status === 'streaming' ||
				(preview.status === 'success' && !shouldClearNetPreview);
			const nextTabs = capFollowCreatedTabs(
				upsertTab(tabs, {
					id,
					type: 'agent-activity',
					title: titleFromPath(preview.path),
					path: preview.path,
					lastAccessedAt: now,
					highlight: undefined,
					annotations:
						shouldShowOperationPreview && !shouldClearNetPreview
							? annotation
								? [annotation]
								: undefined
							: undefined,
					patchPreview: undefined,
					writePreview: undefined,
				}),
			);
			const removedIds = new Set(
				state.tabs
					.map((tab) => tab.id)
					.filter((tabId) => !nextTabs.some((tab) => tab.id === tabId)),
			);
			const retainedPayloads = withoutTabPayloads(
				state.tabPayloads,
				removedIds,
			);
			return {
				...tabsState(nextTabs),
				tabPayloads: {
					patchPreviews: {
						...retainedPayloads.patchPreviews,
						[id]: undefined,
					},
					writePreviews: {
						...retainedPayloads.writePreviews,
						[id]: shouldShowOperationPreview ? writePreview : undefined,
					},
				},
				turnFileChanges: nextTurnFileChanges,
				activeWorkTabId: id,
				activeTabId: activeIdForWorkUpdate(state, id),
			};
		});
	},

	resetFollowTurnChanges: () => set({ turnFileChanges: {} }),

	setMarkdownPreviewEnabled: (path, enabled) =>
		set((state) => ({
			markdownPreviewPaths: {
				...state.markdownPreviewPaths,
				[normalizeViewerPath(path)]: enabled,
			},
		})),

	openSkillFileTab: (skill, file) => {
		const displayFile = file ?? 'SKILL.md';
		const id = `skill-file:${skill}:${displayFile}`;
		set((state) => ({
			...tabsState(
				upsertTab(state.tabs, {
					id,
					type: 'skill-file',
					title: titleFromPath(displayFile),
					skill,
					file,
				}),
			),
			activeMode: 'work',
			activeWorkTabId: id,
			activeTabId: id,
		}));
	},

	openBrowserTab: (url = '', options = {}) => {
		const kind = options.kind ?? 'browser';
		set((state) => {
			const shouldCreate = kind === 'browser' && options.newTab === true;
			const id =
				options.id ?? (shouldCreate ? newBrowserTabId() : browserTabId(kind));
			const existing = state.tabs.find(
				(tab): tab is Extract<ViewerTab, { type: 'browser' }> =>
					!shouldCreate && tab.type === 'browser' && tab.id === id,
			);
			return {
				...tabsState(
					upsertTab(state.tabs, {
						id,
						type: 'browser',
						title: options.title ?? existing?.title ?? 'Browser',
						url: url || existing?.url || '',
						kind,
						reloadKey: existing?.reloadKey ?? 0,
					}),
				),
				activeMode: 'preview',
				activePreviewTabId: id,
				activeTabId: id,
			};
		});
	},

	openTerminalTab: (terminalId, title) => {
		const id = terminalViewerTabId(terminalId);
		set((state) => {
			const existing = state.tabsById[id];
			const existingTitle =
				existing?.type === 'terminal' ? existing.title : undefined;
			return {
				...tabsState(
					upsertTab(state.tabs, {
						id,
						type: 'terminal',
						title: title ?? existingTitle ?? 'Terminal',
						terminalId,
					}),
				),
				activeMode: 'terminal',
				activeTerminalTabId: id,
				activeTabId: id,
			};
		});
	},

	syncTerminalTabs: (terminals) =>
		set((state) => {
			if (!state.tabs.some((tab) => tab.type === 'terminal')) return {};
			const titlesByTabId = new Map(
				terminals.map((terminal) => [
					terminalViewerTabId(terminal.id),
					terminal.title,
				]),
			);
			let changed = false;
			const nextTabs: ViewerTab[] = [];
			for (const tab of state.tabs) {
				if (tab.type !== 'terminal') {
					nextTabs.push(tab);
					continue;
				}
				const title = titlesByTabId.get(tab.id);
				if (title === undefined) {
					changed = true;
					continue;
				}
				if (title && title !== tab.title) {
					nextTabs.push({ ...tab, title });
					changed = true;
					continue;
				}
				nextTabs.push(tab);
			}
			if (!changed) return {};

			const removedIds = state.tabs
				.map((tab) => tab.id)
				.filter((id) => !nextTabs.some((tab) => tab.id === id));
			let activeMode = state.activeMode;
			let activeTerminalTabId = state.activeTerminalTabId;
			if (
				activeTerminalTabId &&
				!nextTabs.some((tab) => tab.id === activeTerminalTabId)
			) {
				activeTerminalTabId =
					nextTabs.find((tab) => modeForTab(tab) === 'terminal')?.id ?? null;
			}
			const nextState = { ...state, activeTerminalTabId };
			if (activeMode === 'terminal' && !activeTerminalTabId) {
				activeMode = activeIdForMode(nextState, 'work')
					? 'work'
					: activeIdForMode(nextState, 'preview')
						? 'preview'
						: activeMode;
			}
			return {
				...tabsState(nextTabs),
				tabPayloads: withoutTabPayloads(state.tabPayloads, removedIds),
				activeMode,
				activeTerminalTabId,
				activeTabId: activeIdForMode(nextState, activeMode),
			};
		}),

	updateBrowserTabUrl: (id, url) =>
		set((state) => ({
			...tabsState(
				state.tabs.map((tab) =>
					tab.id === id && tab.type === 'browser'
						? {
								...tab,
								url,
								title: tab.kind === 'simulator' ? 'Simulator' : 'Browser',
							}
						: tab,
				),
			),
		})),

	reloadBrowserTab: (id) =>
		set((state) => ({
			...tabsState(
				state.tabs.map((tab) =>
					tab.id === id && tab.type === 'browser'
						? { ...tab, reloadKey: tab.reloadKey + 1 }
						: tab,
				),
			),
		})),

	toggleFileTabPinned: (id) =>
		set((state) => ({
			...tabsState(
				state.tabs.map((tab) =>
					tab.id === id && tab.type === 'file'
						? { ...tab, pinned: !tab.pinned }
						: tab,
				),
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
				activeTerminalTabId:
					mode === 'terminal' ? id : state.activeTerminalTabId,
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
			let activeTerminalTabId = state.activeTerminalTabId;

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

			if (
				closingTab &&
				modeForTab(closingTab) === 'terminal' &&
				activeTerminalTabId === id
			) {
				activeTerminalTabId = findFallbackTabId(tabs, 'terminal', closingIndex);
			}

			const nextState = {
				activeWorkTabId,
				activePreviewTabId,
				activeTerminalTabId,
			};
			if (!activeIdForMode(nextState, activeMode)) {
				const fallbackMode = (['work', 'preview', 'terminal'] as const).find(
					(mode) => mode !== activeMode && activeIdForMode(nextState, mode),
				);
				if (fallbackMode) activeMode = fallbackMode;
			}

			return {
				...tabsState(tabs),
				tabPayloads: withoutTabPayloads(state.tabPayloads, [id]),
				activeMode,
				activeWorkTabId,
				activePreviewTabId,
				activeTerminalTabId,
				activeTabId: activeIdForMode(nextState, activeMode),
			};
		}),

	updateSessionFileOperationIndex: (id, index) =>
		set((state) => ({
			...tabsState(
				state.tabs.map((tab) =>
					tab.id === id && tab.type === 'session-file-diff'
						? { ...tab, selectedOperationIndex: index }
						: tab,
				),
			),
		})),

	closeAllTabs: () =>
		set({
			tabs: [],
			tabOrder: [],
			tabsById: {},
			tabPayloads: {
				patchPreviews: {},
				writePreviews: {},
			},
			turnFileChanges: {},
			markdownPreviewPaths: {},
			activeTabId: null,
			activeMode: 'work',
			activeWorkTabId: null,
			activePreviewTabId: null,
			activeTerminalTabId: null,
		}),
}));
