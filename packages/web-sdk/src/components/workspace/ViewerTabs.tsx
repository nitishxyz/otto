import { memo, useEffect } from 'react';
import {
	Braces,
	File,
	FileCode,
	FileJson,
	FileText,
	FileType,
	GitCommit,
	Image,
	Settings,
	X,
} from 'lucide-react';
import {
	useViewerTabsStore,
	type ViewerTab,
} from '../../stores/viewerTabsStore';
import { Button } from '../ui/Button';
import { GitDiffPanel } from '../git/GitDiffPanel';
import { SessionFilesDiffPanel } from '../session-files/SessionFilesDiffPanel';
import { FileViewerPanel } from '../file-browser/FileViewerPanel';
import { SkillViewerPanel } from '../skills/SkillViewerPanel';
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
	}
}

function getFileExtension(path: string): string {
	const extension = path.split('.').pop()?.toLowerCase() ?? '';
	return extension && extension !== path.toLowerCase() ? extension : '';
}

function renderLanguageIcon(extension: string) {
	switch (extension) {
		case 'ts':
		case 'tsx':
			return (
				<span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center bg-[#3178c6] text-[7px] font-bold leading-none text-white">
					TS
				</span>
			);
		case 'js':
		case 'jsx':
		case 'mjs':
		case 'cjs':
			return (
				<span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center bg-[#f7df1e] text-[7px] font-bold leading-none text-black">
					JS
				</span>
			);
		case 'py':
			return (
				<span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-gradient-to-br from-[#3776ab] to-[#ffd43b] text-[7px] font-bold leading-none text-white">
					Py
				</span>
			);
		case 'go':
			return (
				<span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#00add8] text-[7px] font-bold leading-none text-white">
					Go
				</span>
			);
		case 'rs':
			return (
				<span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#ce422b] text-[8px] font-bold leading-none text-white">
					R
				</span>
			);
		case 'json':
			return <FileJson className="h-3.5 w-3.5 shrink-0 text-yellow-500" />;
		case 'md':
		case 'mdx':
			return <FileText className="h-3.5 w-3.5 shrink-0 text-sky-500" />;
		case 'env':
		case 'toml':
		case 'yaml':
		case 'yml':
			return <Settings className="h-3.5 w-3.5 shrink-0 text-violet-500" />;
		case 'css':
		case 'scss':
		case 'sass':
		case 'less':
			return <Braces className="h-3.5 w-3.5 shrink-0 text-blue-500" />;
		case 'html':
		case 'xml':
			return <FileType className="h-3.5 w-3.5 shrink-0 text-orange-500" />;
		case 'png':
		case 'jpg':
		case 'jpeg':
		case 'gif':
		case 'svg':
		case 'webp':
			return <Image className="h-3.5 w-3.5 shrink-0 text-pink-500" />;
		case 'txt':
		case 'log':
			return (
				<FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			);
		default:
			return extension ? (
				<FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
			) : (
				<File className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
			);
	}
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

	const extension = getFileExtension(getTabPath(tab));

	return (
		<span className="shrink-0 inline-flex items-center text-muted-foreground/80">
			{renderLanguageIcon(extension)}
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
