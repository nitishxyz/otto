import { memo, useEffect } from 'react';
import { Code2, GitCommit, Globe2, Smartphone, X } from 'lucide-react';
import {
	useViewerTabsStore,
	type ViewerTab,
} from '../../stores/viewerTabsStore';
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
		case 'tool-preview':
			return tab.toolName === 'write' ? 'write preview' : 'patch preview';
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

function getTabActivityKind(tab: ViewerTab): TabActivityKind | null {
	if (tab.type !== 'file') return null;

	const latestAnnotation = tab.annotations?.at(-1);
	const reason =
		tab.writePreview?.toolName ??
		tab.patchPreview?.toolName ??
		latestAnnotation?.reason;
	if (!reason) return null;

	if (reason === 'write') return 'write';

	if (
		tab.patchPreview &&
		patchTargetsDelete(tab.patchPreview.patch, tab.path)
	) {
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

export const ViewerTabs = memo(function ViewerTabs() {
	const tabs = useViewerTabsStore((state) => state.tabs);
	const activeTabId = useViewerTabsStore((state) => state.activeTabId);
	const activeMode = useViewerTabsStore((state) => state.activeMode);
	const setViewerMode = useViewerTabsStore((state) => state.setViewerMode);
	const openBrowserTab = useViewerTabsStore((state) => state.openBrowserTab);
	const setActiveTab = useViewerTabsStore((state) => state.setActiveTab);
	const closeTab = useViewerTabsStore((state) => state.closeTab);
	const closeAllTabs = useViewerTabsStore((state) => state.closeAllTabs);
	const updateSessionFileOperationIndex = useViewerTabsStore(
		(state) => state.updateSessionFileOperationIndex,
	);

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

	if (tabs.length === 0) return null;

	const workTabs = tabs.filter((tab) => !isPreviewTab(tab));
	const previewTabs = tabs.filter(isPreviewTab);
	const visibleTabs = activeMode === 'preview' ? previewTabs : workTabs;
	const activeTab =
		visibleTabs.find((tab) => tab.id === activeTabId) ?? visibleTabs[0] ?? null;
	const showWorkActivityDot = activeMode === 'preview' && workTabs.length > 0;
	const handlePreviewMode = () => {
		if (previewTabs.length === 0) {
			openBrowserTab();
			return;
		}
		setViewerMode('preview');
	};

	return (
		<section className="h-full w-full min-w-0 bg-sidebar flex flex-col">
			<div className="h-12 shrink-0 bg-background flex overflow-hidden">
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
							onClick={handlePreviewMode}
							title="Preview tabs"
							aria-label="Preview tabs"
							className={`${VIEWER_MODE_TAB_BUTTON_BASE} left-[2.375rem]`}
						/>
					</div>
				</div>
				<div className="h-12 min-w-0 flex-1 flex overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide">
					{visibleTabs.map((tab) => {
						const isActive = tab.id === activeTab.id;
						const activityKind = getTabActivityKind(tab);
						return (
							<div
								key={tab.id}
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
									{renderTabActivityBadge(activityKind)}
								</button>
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
					})}
					<div className="min-w-8 flex-1 border-b border-sidebar-border bg-background" />
					<div className="h-12 shrink-0 border-b border-l border-sidebar-border bg-background flex items-center px-1.5">
						<button
							type="button"
							onClick={closeAllTabs}
							title="Close all tabs and collapse viewer"
							aria-label="Close all tabs and collapse viewer"
							className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			</div>

			<div className="relative flex-1 min-h-0 overflow-hidden">
				{previewTabs.map((tab) => {
					const isActive = activeMode === 'preview' && tab.id === activeTab?.id;
					return (
						<div
							key={tab.id}
							aria-hidden={!isActive}
							className={`absolute inset-0 ${isActive ? 'block' : 'hidden'}`}
						>
							<BrowserViewerPanel tab={tab} />
						</div>
					);
				})}
				{activeMode === 'work' && activeTab && (
					<div className="absolute inset-0">
						{renderTabContent(
							activeTab,
							closeTab,
							updateSessionFileOperationIndex,
						)}
					</div>
				)}
				{!activeTab && (
					<div className="absolute inset-0 flex items-center justify-center bg-sidebar text-muted-foreground/60 text-sm">
						{activeMode === 'work'
							? 'No work tabs open'
							: 'No preview tabs open'}
					</div>
				)}
			</div>
		</section>
	);
});
