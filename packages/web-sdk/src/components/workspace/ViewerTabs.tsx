import { memo } from 'react';
import { FileCode, FileText, GitCommit, X } from 'lucide-react';
import {
	useViewerTabsStore,
	type ViewerTab,
} from '../../stores/viewerTabsStore';
import { Button } from '../ui/Button';
import { GitDiffPanel } from '../git/GitDiffPanel';
import { SessionFilesDiffPanel } from '../session-files/SessionFilesDiffPanel';
import { FileViewerPanel } from '../file-browser/FileViewerPanel';
import { SkillViewerPanel } from '../skills/SkillViewerPanel';

function tabKindLabel(tab: ViewerTab): string {
	switch (tab.type) {
		case 'git-diff':
			return tab.staged ? 'staged diff' : 'diff';
		case 'session-file-diff':
			return 'session diff';
		case 'file':
			return 'file';
		case 'skill-file':
			return tab.skill;
	}
}

function getTabPath(tab: ViewerTab): string {
	switch (tab.type) {
		case 'git-diff':
		case 'session-file-diff':
		case 'file':
			return tab.path;
		case 'skill-file':
			return tab.file ?? 'SKILL.md';
	}
}

function getFileExtension(path: string): string {
	const extension = path.split('.').pop()?.toLowerCase() ?? '';
	return extension && extension !== path.toLowerCase() ? extension : '';
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

	const extension = getFileExtension(getTabPath(tab));
	const isTextLike = ['md', 'mdx', 'txt', 'env'].includes(extension);
	const Icon = isTextLike ? FileText : FileCode;

	return (
		<span className="shrink-0 inline-flex items-center gap-1 text-muted-foreground/80">
			<Icon className="h-3.5 w-3.5" />
			{extension && (
				<span className="max-w-9 truncate rounded bg-muted px-1 py-0.5 text-[9px] uppercase leading-none text-muted-foreground">
					{extension}
				</span>
			)}
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
					onClose={() => closeTab(tab.id)}
				/>
			);
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
	}
}

export const ViewerTabs = memo(function ViewerTabs() {
	const tabs = useViewerTabsStore((state) => state.tabs);
	const activeTabId = useViewerTabsStore((state) => state.activeTabId);
	const setActiveTab = useViewerTabsStore((state) => state.setActiveTab);
	const closeTab = useViewerTabsStore((state) => state.closeTab);
	const updateSessionFileOperationIndex = useViewerTabsStore(
		(state) => state.updateSessionFileOperationIndex,
	);

	if (tabs.length === 0) return null;

	const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

	return (
		<section className="h-full w-full min-w-0 bg-sidebar flex flex-col">
			<div className="h-12 shrink-0 bg-background flex overflow-x-auto overflow-y-hidden">
				{tabs.map((tab) => {
					const isActive = tab.id === activeTab.id;
					return (
						<div
							key={tab.id}
							className={`group h-12 max-w-56 min-w-0 px-3 border-r border-sidebar-border flex items-center gap-2 text-left transition-colors ${
								isActive
									? 'bg-sidebar text-sidebar-foreground'
									: 'border-b bg-background text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-accent/40'
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
			</div>

			<div className="flex-1 min-h-0 overflow-hidden">
				{renderTabContent(activeTab, closeTab, updateSessionFileOperationIndex)}
			</div>
		</section>
	);
});
