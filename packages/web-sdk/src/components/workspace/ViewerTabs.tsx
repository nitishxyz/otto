import { memo, useEffect, useRef } from 'react';
import { Code2, GitCommit, Globe2, Pin, Smartphone, X } from 'lucide-react';
import {
	hydrateViewerTab,
	useViewerTabsStore,
	type ViewerTab,
	type ViewerTabPayloadCache,
} from '../../stores/viewerTabsStore';
import { getScrollLeftToRevealTarget } from '../../lib/viewerTabScroll';
import { FileTypeIcon } from '../common/FileTypeIcon';
import { Button } from '../ui/Button';
import { GitDiffPanel } from '../git/GitDiffPanel';
import { SessionFilesDiffPanel } from '../session-files/SessionFilesDiffPanel';
import { FileViewerPanel } from '../file-browser/FileViewerPanel';
import { SkillViewerPanel } from '../skills/SkillViewerPanel';
import { BrowserViewerPanel } from '../browser/BrowserViewerPanel';
import { ToolPreviewPanel } from './ToolPreviewPanel';

function tabKindLabel(tab: ViewerTab): string {
	switch (tab.type) {
		case 'git-diff':
			return tab.staged ? 'staged diff' : 'diff';
		case 'session-file-diff':
			return 'session diff';
		case 'file':
			return 'file';
		case 'agent-activity':
			return 'agent activity';
		case 'tool-preview':
			return tab.toolName === 'write'
				? 'write preview'
				: `${tab.toolName.replace('_', '-')} preview`;
		case 'skill-file':
			return tab.skill;
		case 'browser':
			return tab.kind === 'simulator' ? 'simulator' : 'browser';
	}
}

function getTabPath(tab: ViewerTab): string {
	switch (tab.type) {
		case 'git-diff':
		case 'session-file-diff':
		case 'file':
		case 'agent-activity':
		case 'tool-preview':
			return tab.path;
		case 'skill-file':
			return tab.file ?? 'SKILL.md';
		case 'browser':
			return tab.url || tab.title;
	}
}

function isPreviewTab(
	tab: ViewerTab,
): tab is Extract<ViewerTab, { type: 'browser' }> {
	return tab.type === 'browser';
}

function renderTabIcon(tab: ViewerTab) {
	if (tab.type === 'git-diff') {
		return (
			<GitCommit
				className={`h-3.5 w-3.5 shrink-0 ${
					tab.staged ? 'text-emerald-500' : 'text-amber-500'
				}`}
			/>
		);
	}

	if (tab.type === 'session-file-diff') {
		return <GitCommit className="h-3.5 w-3.5 shrink-0 text-sky-500" />;
	}

	if (tab.type === 'tool-preview') {
		return (
			<GitCommit
				className={`h-3.5 w-3.5 shrink-0 ${
					tab.status === 'error'
						? 'text-red-500'
						: tab.status === 'success'
							? 'text-emerald-500'
							: 'text-blue-500'
				}`}
			/>
		);
	}

	if (tab.type === 'browser') {
		return tab.kind === 'simulator' ? (
			<Smartphone className="h-3.5 w-3.5 shrink-0 text-violet-500" />
		) : (
			<Globe2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />
		);
	}

	const path = getTabPath(tab);

	return (
		<span className="shrink-0 inline-flex items-center text-muted-foreground/80">
			<FileTypeIcon path={path} />
		</span>
	);
}

type TabActivityKind = 'write' | 'patch' | 'delete';

function patchTargetsDelete(
	patch: string | undefined,
	targetPath: string,
): boolean {
	if (!patch) return false;
	const normalize = (path: string) =>
		path
			.trim()
			.replace(/^a\//, '')
			.replace(/^b\//, '')
			.replace(/^\.\//, '')
			.replace(/\/+/g, '/')
			.replace(/\/+$/, '');
	const normalizedTarget = normalize(targetPath);
	for (const rawLine of patch.split('\n')) {
		const line = rawLine.trim();
		const deleteEnveloped = line.match(/^\*\*\* Delete File: (.+)$/);
		if (deleteEnveloped?.[1]) {
			const directivePath = normalize(deleteEnveloped[1]);
			if (
				directivePath === normalizedTarget ||
				directivePath.endsWith(`/${normalizedTarget}`) ||
				normalizedTarget.endsWith(`/${directivePath}`)
			) {
				return true;
			}
		}
	}
	return false;
}

function getTabActivityKind(
	tab: ViewerTab,
	payloads: ViewerTabPayloadCache,
): TabActivityKind | null {
	if (tab.type !== 'file' && tab.type !== 'agent-activity') return null;

	const patchPreview = payloads.patchPreviews[tab.id] ?? tab.patchPreview;
	const writePreview = payloads.writePreviews[tab.id] ?? tab.writePreview;
	const latestAnnotation = tab.annotations?.at(-1);
	const reason =
		writePreview?.toolName ??
		patchPreview?.toolName ??
		latestAnnotation?.reason;
	if (!reason) return null;

	if (reason === 'write') return 'write';

	if (patchPreview && patchTargetsDelete(patchPreview.patch, tab.path)) {
		return 'delete';
	}
	return 'patch';
}

const ACTIVITY_BADGE_CLASSES: Record<TabActivityKind, string> = {
	write: 'border-blue-400/50 bg-blue-500/10 text-blue-600 dark:text-blue-300',
	patch:
		'border-emerald-400/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
	delete: 'border-red-400/50 bg-red-500/10 text-red-600 dark:text-red-300',
};

const ACTIVITY_BADGE_LETTERS: Record<TabActivityKind, string> = {
	write: 'W',
	patch: 'P',
	delete: 'D',
};

const ACTIVITY_TITLES: Record<TabActivityKind, string> = {
	write: 'Written',
	patch: 'Patched',
	delete: 'Deleted',
};

function renderTabActivityBadge(kind: TabActivityKind | null) {
	if (!kind) return null;
	return (
		<span
			className={`shrink-0 rounded-[4px] border px-1 py-0.5 font-mono text-[9px] font-semibold leading-none ${ACTIVITY_BADGE_CLASSES[kind]}`}
			title={ACTIVITY_TITLES[kind]}
		>
			{ACTIVITY_BADGE_LETTERS[kind]}
		</span>
	);
}

function renderTabContent(
	tab: ViewerTab,
	closeTab: (id: string) => void,
	updateSessionFileOperationIndex: (id: string, index: number) => void,
) {
	switch (tab.type) {
		case 'git-diff':
			return (
				<GitDiffPanel
					mode="pane"
					open
					file={tab.path}
					staged={tab.staged}
					onClose={() => closeTab(tab.id)}
				/>
			);
		case 'session-file-diff':
			return (
				<SessionFilesDiffPanel
					mode="pane"
					open
					file={tab.path}
					operations={tab.operations}
					operationIndex={tab.selectedOperationIndex}
					onOperationIndexChange={(index) =>
						updateSessionFileOperationIndex(tab.id, index)
					}
					onClose={() => closeTab(tab.id)}
				/>
			);
		case 'file':
			return (
				<FileViewerPanel
					mode="pane"
					open
					file={tab.path}
					highlight={tab.highlight}
					annotations={tab.annotations}
					patchPreview={tab.patchPreview}
					writePreview={tab.writePreview}
					onClose={() => closeTab(tab.id)}
				/>
			);
		case 'agent-activity':
			return (
				<FileViewerPanel
					mode="pane"
					open
					file={tab.path}
					highlight={tab.highlight}
					annotations={tab.annotations}
					patchPreview={tab.patchPreview}
					writePreview={tab.writePreview}
					activityView
					onClose={() => closeTab(tab.id)}
				/>
			);
		case 'tool-preview':
			return <ToolPreviewPanel tab={tab} />;
		case 'skill-file':
			return (
				<SkillViewerPanel
					mode="pane"
					open
					skillName={tab.skill}
					file={tab.file}
					onClose={() => closeTab(tab.id)}
				/>
			);
		case 'browser':
			return <BrowserViewerPanel tab={tab} />;
	}
}

const VIEWER_MODE_TAB_BUTTON_BASE =
	'absolute top-0.5 z-20 h-7 w-9 rounded-full p-0 leading-none transform-none select-none bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:transform-none';

const VIEWER_MODE_ICON_BASE_CLASS =
	'pointer-events-none absolute top-1/2 z-10 block h-4 w-4 -translate-x-1/2 -translate-y-1/2 shrink-0 transition-colors';

function getTabIdsForMode(
	tabOrder: string[],
	tabsById: Record<string, ViewerTab | undefined>,
	mode: 'work' | 'preview',
): string[] {
	return tabOrder.filter((id) => {
		const tab = tabsById[id];
		if (!tab) return false;
		return mode === 'preview' ? isPreviewTab(tab) : !isPreviewTab(tab);
	});
}

function getFirstTabIdForMode(
	tabOrder: string[],
	tabsById: Record<string, ViewerTab | undefined>,
	mode: 'work' | 'preview',
): string | null {
	return getTabIdsForMode(tabOrder, tabsById, mode)[0] ?? null;
}

function useViewerTabsKeyboardShortcuts() {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const isInInput =
				target?.tagName === 'INPUT' ||
				target?.tagName === 'TEXTAREA' ||
				target?.isContentEditable;

			if (isInInput || event.key.toLowerCase() !== 'w') return;
			if (!event.metaKey && !event.ctrlKey) return;

			const activeId = useViewerTabsStore.getState().activeTabId;
			if (!activeId) return;

			event.preventDefault();
			useViewerTabsStore.getState().closeTab(activeId);
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, []);
}

const ViewerModeControls = memo(function ViewerModeControls() {
	const activeMode = useViewerTabsStore((state) => state.activeMode);
	const workTabCount = useViewerTabsStore(
		(state) => getTabIdsForMode(state.tabOrder, state.tabsById, 'work').length,
	);
	const previewTabCount = useViewerTabsStore(
		(state) =>
			getTabIdsForMode(state.tabOrder, state.tabsById, 'preview').length,
	);
	const setViewerMode = useViewerTabsStore((state) => state.setViewerMode);
	const openBrowserTab = useViewerTabsStore((state) => state.openBrowserTab);
	const showWorkActivityDot = activeMode === 'preview' && workTabCount > 0;

	return (
		<div className="h-12 shrink-0 border-r border-b border-sidebar-border bg-background flex items-center px-2">
			<div
				role="tablist"
				aria-label="Viewer mode"
				className="relative h-8 w-[4.75rem] shrink-0 rounded-full ring-1 ring-inset ring-sidebar-border bg-muted/40 p-0.5"
			>
				<span
					aria-hidden="true"
					className={`absolute left-0.5 inset-y-0.5 w-9 rounded-full bg-background shadow-sm ring-1 ring-sidebar-border transition-transform duration-200 ease-out pointer-events-none ${
						activeMode === 'preview' ? 'translate-x-9' : 'translate-x-0'
					}`}
				/>
				<Code2
					aria-hidden="true"
					className={`${VIEWER_MODE_ICON_BASE_CLASS} left-5 ${
						activeMode === 'work'
							? 'text-foreground'
							: 'text-muted-foreground/70'
					}`}
				/>
				<Globe2
					aria-hidden="true"
					className={`${VIEWER_MODE_ICON_BASE_CLASS} left-14 ${
						activeMode === 'preview'
							? 'text-foreground'
							: 'text-muted-foreground/70'
					}`}
				/>
				{showWorkActivityDot && (
					<span className="pointer-events-none absolute left-[2rem] top-1 z-10 h-1.5 w-1.5 rounded-full bg-primary" />
				)}
				<button
					type="button"
					role="tab"
					aria-selected={activeMode === 'work'}
					onClick={() => setViewerMode('work')}
					title="Work tabs"
					aria-label="Work tabs"
					className={`${VIEWER_MODE_TAB_BUTTON_BASE} left-0.5`}
				/>
				<button
					type="button"
					role="tab"
					aria-selected={activeMode === 'preview'}
					onClick={() => {
						if (previewTabCount === 0) {
							openBrowserTab();
							return;
						}
						setViewerMode('preview');
					}}
					title="Preview tabs"
					aria-label="Preview tabs"
					className={`${VIEWER_MODE_TAB_BUTTON_BASE} left-[2.375rem]`}
				/>
			</div>
		</div>
	);
});

const CloseAllTabsButton = memo(function CloseAllTabsButton() {
	const closeAllTabs = useViewerTabsStore((state) => state.closeAllTabs);

	return (
		<div className="h-12 w-12 shrink-0 border-r border-b border-sidebar-border bg-background flex items-stretch">
			<button
				type="button"
				onClick={closeAllTabs}
				title="Close all tabs and collapse viewer"
				aria-label="Close all tabs and collapse viewer"
				className="h-full w-full inline-flex items-center justify-center rounded-none text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive active:translate-y-0 active:scale-100"
			>
				<X className="h-3.5 w-3.5" />
			</button>
		</div>
	);
});

function getActiveTabIdForMode(
	activeTabId: string | null,
	tabOrder: string[],
	tabsById: Record<string, ViewerTab | undefined>,
	mode: 'work' | 'preview',
): string | null {
	const activeTab = activeTabId ? tabsById[activeTabId] : undefined;
	if (
		activeTab &&
		(mode === 'preview' ? isPreviewTab(activeTab) : !isPreviewTab(activeTab))
	) {
		return activeTab.id;
	}
	return getFirstTabIdForMode(tabOrder, tabsById, mode);
}

const ViewerTabStrip = memo(function ViewerTabStrip() {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const activeMode = useViewerTabsStore((state) => state.activeMode);
	const activeTabId = useViewerTabsStore((state) => state.activeTabId);
	const tabOrder = useViewerTabsStore((state) => state.tabOrder);
	const tabsById = useViewerTabsStore((state) => state.tabsById);
	const tabIds = getTabIdsForMode(tabOrder, tabsById, activeMode);
	const tabCount = tabIds.length;
	const selectedTabId = getActiveTabIdForMode(
		activeTabId,
		tabOrder,
		tabsById,
		activeMode,
	);

	useEffect(() => {
		if (!selectedTabId || tabCount === 0) return;

		const frame = window.requestAnimationFrame(() => {
			const container = scrollContainerRef.current;
			const target = container?.querySelector(
				'[data-viewer-tab-active="true"]',
			);
			if (!container || !(target instanceof HTMLElement)) return;

			const containerRect = container.getBoundingClientRect();
			const targetRect = target.getBoundingClientRect();
			const nextScrollLeft = getScrollLeftToRevealTarget({
				containerLeft: containerRect.left,
				containerRight: containerRect.right,
				targetLeft: targetRect.left,
				targetRight: targetRect.right,
				currentScrollLeft: container.scrollLeft,
			});
			if (nextScrollLeft === null) return;

			container.scrollTo({ left: nextScrollLeft, behavior: 'smooth' });
		});

		return () => window.cancelAnimationFrame(frame);
	}, [selectedTabId, tabCount]);

	return (
		<div
			ref={scrollContainerRef}
			className="h-12 min-w-0 flex-1 flex overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide"
		>
			{tabIds.map((tabId) => (
				<ViewerTabButton
					key={tabId}
					tabId={tabId}
					isActive={tabId === selectedTabId}
				/>
			))}
			<div className="min-w-8 flex-1 border-b border-sidebar-border bg-background" />
		</div>
	);
});

const ViewerTabButton = memo(function ViewerTabButton({
	tabId,
	isActive,
}: {
	tabId: string;
	isActive: boolean;
}) {
	const tab = useViewerTabsStore((state) => state.tabsById[tabId]);
	const patchPreview = useViewerTabsStore(
		(state) => state.tabPayloads.patchPreviews[tabId],
	);
	const writePreview = useViewerTabsStore(
		(state) => state.tabPayloads.writePreviews[tabId],
	);
	const setActiveTab = useViewerTabsStore((state) => state.setActiveTab);
	const closeTab = useViewerTabsStore((state) => state.closeTab);
	const toggleFileTabPinned = useViewerTabsStore(
		(state) => state.toggleFileTabPinned,
	);
	if (!tab) return null;

	const activityKind = getTabActivityKind(tab, {
		patchPreviews: { [tabId]: patchPreview },
		writePreviews: { [tabId]: writePreview },
	});

	return (
		<div
			data-viewer-tab-active={isActive ? 'true' : undefined}
			className={`group h-12 w-44 max-w-56 shrink-0 px-3 border-r border-b border-sidebar-border flex items-center gap-2 text-left transition-colors ${
				isActive
					? 'border-b-transparent bg-sidebar text-sidebar-foreground'
					: 'bg-background text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-accent/40'
			}`}
			title={`${tab.title}\n${tabKindLabel(tab)}`}
		>
			<button
				type="button"
				onClick={() => setActiveTab(tab.id)}
				className="min-w-0 flex-1 h-full flex items-center gap-2 text-left"
			>
				{renderTabIcon(tab)}
				<span className="min-w-0 flex-1 truncate text-[12px] font-mono">
					{tab.title}
				</span>
				{tab.type === 'file' && tab.pinned ? (
					<Pin className="h-3 w-3 shrink-0 fill-current text-blue-500" />
				) : null}
				{renderTabActivityBadge(activityKind)}
			</button>
			{tab.type === 'file' ? (
				<Button
					variant="ghost"
					size="icon"
					onClick={() => {
						toggleFileTabPinned(tab.id);
					}}
					title={
						tab.pinned
							? 'Unpin tab from follow-mode cleanup'
							: 'Pin tab to keep it during follow-mode cleanup'
					}
					className={`h-6 w-6 shrink-0 ${
						tab.pinned
							? 'opacity-100 text-blue-500'
							: 'opacity-0 group-hover:opacity-70'
					}`}
				>
					<Pin className={`h-3.5 w-3.5 ${tab.pinned ? 'fill-current' : ''}`} />
				</Button>
			) : null}
			<Button
				variant="ghost"
				size="icon"
				onClick={() => {
					closeTab(tab.id);
				}}
				title="Close tab"
				className="h-6 w-6 opacity-60 group-hover:opacity-100 shrink-0"
			>
				<X className="h-3.5 w-3.5" />
			</Button>
		</div>
	);
});

const ViewerHeader = memo(function ViewerHeader() {
	return (
		<div className="h-12 shrink-0 bg-background flex overflow-hidden">
			<ViewerModeControls />
			<CloseAllTabsButton />
			<ViewerTabStrip />
		</div>
	);
});

const PreviewPaneStrip = memo(function PreviewPaneStrip() {
	const activeMode = useViewerTabsStore((state) => state.activeMode);
	const activeTabId = useViewerTabsStore((state) => state.activeTabId);
	const tabOrder = useViewerTabsStore((state) => state.tabOrder);
	const tabsById = useViewerTabsStore((state) => state.tabsById);
	const previewTabIds = getTabIdsForMode(tabOrder, tabsById, 'preview');
	const activePreviewTabId = getActiveTabIdForMode(
		activeTabId,
		tabOrder,
		tabsById,
		'preview',
	);

	return (
		<>
			{previewTabIds.map((tabId) => (
				<PreviewPane
					key={tabId}
					tabId={tabId}
					isActive={activeMode === 'preview' && tabId === activePreviewTabId}
				/>
			))}
		</>
	);
});

const PreviewPane = memo(function PreviewPane({
	tabId,
	isActive,
}: {
	tabId: string;
	isActive: boolean;
}) {
	const tab = useViewerTabsStore((state) => state.tabsById[tabId]);
	if (!tab || tab.type !== 'browser') return null;

	return (
		<div
			aria-hidden={!isActive}
			className={`absolute inset-0 ${isActive ? 'block' : 'hidden'}`}
		>
			<BrowserViewerPanel tab={tab} isActive={isActive} />
		</div>
	);
});

const ActiveWorkPane = memo(function ActiveWorkPane() {
	const activeMode = useViewerTabsStore((state) => state.activeMode);
	const activeTabId = useViewerTabsStore((state) => state.activeTabId);
	const activeWorkTabId = useViewerTabsStore((state) =>
		getActiveTabIdForMode(activeTabId, state.tabOrder, state.tabsById, 'work'),
	);
	const tabMetadata = useViewerTabsStore((state) =>
		activeWorkTabId ? state.tabsById[activeWorkTabId] : undefined,
	);
	const patchPreview = useViewerTabsStore((state) =>
		activeWorkTabId
			? state.tabPayloads.patchPreviews[activeWorkTabId]
			: undefined,
	);
	const writePreview = useViewerTabsStore((state) =>
		activeWorkTabId
			? state.tabPayloads.writePreviews[activeWorkTabId]
			: undefined,
	);
	const tab = hydrateViewerTab(tabMetadata, {
		patchPreviews: activeWorkTabId ? { [activeWorkTabId]: patchPreview } : {},
		writePreviews: activeWorkTabId ? { [activeWorkTabId]: writePreview } : {},
	});
	const closeTab = useViewerTabsStore((state) => state.closeTab);
	const updateSessionFileOperationIndex = useViewerTabsStore(
		(state) => state.updateSessionFileOperationIndex,
	);

	if (activeMode !== 'work' || !tab) return null;

	return (
		<div className="absolute inset-0">
			{renderTabContent(tab, closeTab, updateSessionFileOperationIndex)}
		</div>
	);
});

const EmptyActivePaneMessage = memo(function EmptyActivePaneMessage() {
	const activeMode = useViewerTabsStore((state) => state.activeMode);
	const activeTabId = useViewerTabsStore((state) => state.activeTabId);
	const activeModeTabId = useViewerTabsStore((state) =>
		getActiveTabIdForMode(
			activeTabId,
			state.tabOrder,
			state.tabsById,
			activeMode,
		),
	);

	if (activeModeTabId) return null;

	return (
		<div className="absolute inset-0 flex items-center justify-center bg-sidebar text-muted-foreground/60 text-sm">
			{activeMode === 'work' ? 'No work tabs open' : 'No preview tabs open'}
		</div>
	);
});

const ViewerPaneArea = memo(function ViewerPaneArea() {
	return (
		<div className="relative flex-1 min-h-0 overflow-hidden">
			<PreviewPaneStrip />
			<ActiveWorkPane />
			<EmptyActivePaneMessage />
		</div>
	);
});

export const ViewerTabs = memo(function ViewerTabs() {
	const tabCount = useViewerTabsStore((state) => state.tabOrder.length);
	useViewerTabsKeyboardShortcuts();

	if (tabCount === 0) return null;

	return (
		<section
			className="h-full w-full min-w-0 bg-sidebar flex flex-col"
			data-smart-edge-ignore
			data-smart-edge-ignore-mode="content"
		>
			<ViewerHeader />
			<ViewerPaneArea />
		</section>
	);
});
