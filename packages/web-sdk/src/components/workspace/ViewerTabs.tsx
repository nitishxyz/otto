import { Icon, addCollection } from '@iconify/react';
import { icons as materialIconTheme } from '@iconify-json/material-icon-theme';
import { memo, useEffect } from 'react';
import { Code2, GitCommit, Globe2, Smartphone, X } from 'lucide-react';
import {
	useViewerTabsStore,
	type ViewerTab,
} from '../../stores/viewerTabsStore';
import { Button } from '../ui/Button';
import { GitDiffPanel } from '../git/GitDiffPanel';
import { SessionFilesDiffPanel } from '../session-files/SessionFilesDiffPanel';
import { FileViewerPanel } from '../file-browser/FileViewerPanel';
import { SkillViewerPanel } from '../skills/SkillViewerPanel';
import { BrowserViewerPanel } from '../browser/BrowserViewerPanel';
import { ToolPreviewPanel } from './ToolPreviewPanel';

addCollection(materialIconTheme);

const ICON_CLASS = 'h-3.5 w-3.5 shrink-0';

const FILENAME_ICON_MAP: Record<string, string> = {
	'.dockerignore': 'docker',
	'.editorconfig': 'editorconfig',
	'.env': 'settings',
	'.env.example': 'settings',
	'.env.local': 'settings',
	'.eslintignore': 'eslint',
	'.eslintrc': 'eslint',
	'.gitattributes': 'git',
	'.gitignore': 'git',
	'.prettierrc': 'prettier',
	'astro.config.mjs': 'astro-config',
	'astro.config.ts': 'astro-config',
	'biome.json': 'biome',
	'bun.lock': 'bun',
	'bun.lockb': 'bun',
	'bunfig.toml': 'bun',
	'cargo.lock': 'lock',
	'cargo.toml': 'rust',
	'compose.yaml': 'docker',
	'compose.yml': 'docker',
	'docker-compose.yaml': 'docker',
	'docker-compose.yml': 'docker',
	dockerfile: 'docker',
	'eslint.config.js': 'eslint',
	'eslint.config.mjs': 'eslint',
	'eslint.config.ts': 'eslint',
	gemfile: 'gemfile',
	'go.mod': 'go-mod',
	'go.sum': 'go-mod',
	'jsconfig.json': 'jsconfig',
	license: 'license',
	makefile: 'makefile',
	'next.config.js': 'next',
	'next.config.mjs': 'next',
	'next.config.ts': 'next',
	'package-lock.json': 'npm',
	'package.json': 'npm',
	'pnpm-lock.yaml': 'pnpm',
	'postcss.config.js': 'postcss',
	'postcss.config.mjs': 'postcss',
	'postcss.config.ts': 'postcss',
	'prettier.config.js': 'prettier',
	'prettier.config.mjs': 'prettier',
	'prettier.config.ts': 'prettier',
	'readme.md': 'readme',
	'readme.mdx': 'readme',
	'rollup.config.js': 'rollup',
	'rollup.config.mjs': 'rollup',
	'rollup.config.ts': 'rollup',
	'svelte.config.js': 'svelte',
	'svelte.config.ts': 'svelte',
	'tailwind.config.js': 'tailwindcss',
	'tailwind.config.ts': 'tailwindcss',
	'tauri.conf.json': 'tauri',
	'tsconfig.json': 'tsconfig',
	'vite.config.js': 'vite',
	'vite.config.mjs': 'vite',
	'vite.config.ts': 'vite',
	'vitest.config.js': 'vitest',
	'vitest.config.mjs': 'vitest',
	'vitest.config.ts': 'vitest',
	'vue.config.js': 'vue-config',
	'vue.config.ts': 'vue-config',
	'yarn.lock': 'lock',
};

const EXTENSION_ICON_MAP: Record<string, string> = {
	ai: 'image',
	astro: 'astro',
	avif: 'image',
	bash: 'console',
	bmp: 'image',
	c: 'c',
	cc: 'cpp',
	clj: 'clojure',
	cljc: 'clojure',
	cljs: 'clojure',
	cpp: 'cpp',
	cs: 'csharp',
	css: 'css',
	cxx: 'cpp',
	dart: 'dart',
	dockerfile: 'docker',
	ex: 'elixir',
	exs: 'elixir',
	erl: 'erlang',
	fish: 'console',
	gif: 'image',
	go: 'go',
	graphql: 'graphql',
	gql: 'graphql',
	groovy: 'groovy',
	h: 'c',
	hpp: 'cpp',
	hrl: 'erlang',
	hs: 'haskell',
	htm: 'html',
	html: 'html',
	hxx: 'cpp',
	ico: 'favicon',
	java: 'java',
	jpeg: 'image',
	jpg: 'image',
	js: 'javascript',
	json: 'json',
	jsonc: 'json',
	jsx: 'react',
	jl: 'julia',
	kt: 'kotlin',
	kts: 'kotlin',
	less: 'less',
	log: 'log',
	lua: 'lua',
	luau: 'luau',
	mjs: 'javascript',
	ml: 'ocaml',
	mli: 'ocaml',
	mov: 'video',
	mp3: 'audio',
	mp4: 'video',
	md: 'markdown',
	mdx: 'markdown',
	nim: 'nim',
	pdf: 'pdf',
	php: 'php-elephant',
	png: 'image',
	prisma: 'prisma',
	proto: 'proto',
	ps1: 'powershell',
	py: 'python',
	pyw: 'python',
	r: 'r',
	rb: 'ruby',
	rs: 'rust',
	sass: 'sass',
	scala: 'scala',
	scss: 'sass',
	sh: 'console',
	sql: 'database',
	svg: 'svg',
	svelte: 'svelte',
	swift: 'swift',
	toml: 'toml',
	ts: 'typescript',
	tsx: 'react-ts',
	txt: 'document',
	vue: 'vue',
	wav: 'audio',
	webm: 'video',
	webp: 'image',
	xml: 'xml',
	yaml: 'yaml',
	yml: 'yaml',
	zig: 'zig',
	zip: 'zip',
	zsh: 'console',
};

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

function isPreviewTab(tab: ViewerTab): boolean {
	return tab.type === 'browser';
}

function getFileExtension(path: string): string {
	const extension = path.split('.').pop()?.toLowerCase() ?? '';
	return extension && extension !== path.toLowerCase() ? extension : '';
}

function getFileName(path: string): string {
	return path.split(/[\\/]/).pop()?.toLowerCase() ?? path.toLowerCase();
}

function getIconNameForPath(path: string): string {
	const fileName = getFileName(path);
	const fileIcon = FILENAME_ICON_MAP[fileName];
	if (fileIcon) return fileIcon;

	if (fileName.endsWith('.d.ts')) return 'typescript-def';
	if (fileName.endsWith('.test.ts') || fileName.endsWith('.spec.ts')) {
		return 'test-ts';
	}
	if (fileName.endsWith('.test.js') || fileName.endsWith('.spec.js')) {
		return 'test-js';
	}
	if (
		fileName.endsWith('.test.jsx') ||
		fileName.endsWith('.spec.jsx') ||
		fileName.endsWith('.test.tsx') ||
		fileName.endsWith('.spec.tsx')
	) {
		return 'test-jsx';
	}

	const extension = getFileExtension(fileName);
	return EXTENSION_ICON_MAP[extension] ?? 'document';
}

function renderFileIcon(path: string) {
	return (
		<Icon
			aria-hidden="true"
			className={ICON_CLASS}
			icon={`material-icon-theme:${getIconNameForPath(path)}`}
		/>
	);
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
			{renderFileIcon(path)}
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
						className="relative h-8 inline-flex items-center rounded-full ring-1 ring-inset ring-sidebar-border bg-muted/40 p-0.5"
					>
						<span
							aria-hidden="true"
							className={`absolute left-0.5 inset-y-0.5 w-9 rounded-full bg-background shadow-sm ring-1 ring-sidebar-border transition-transform duration-200 ease-out pointer-events-none ${
								activeMode === 'preview'
									? 'translate-x-9'
									: 'translate-x-0'
							}`}
						/>
						<button
							type="button"
							role="tab"
							aria-selected={activeMode === 'work'}
							onClick={() => setViewerMode('work')}
							title="Work tabs"
							aria-label="Work tabs"
							className={`relative z-10 h-7 w-9 inline-flex items-center justify-center rounded-full p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors ${
								activeMode === 'work'
									? 'text-foreground'
									: 'text-muted-foreground/70 hover:text-foreground'
							}`}
						>
							<Code2 className="h-4 w-4" />
							{showWorkActivityDot && (
								<span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
							)}
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={activeMode === 'preview'}
							onClick={handlePreviewMode}
							title="Preview tabs"
							aria-label="Preview tabs"
							className={`relative z-10 h-7 w-9 inline-flex items-center justify-center rounded-full p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors ${
								activeMode === 'preview'
									? 'text-foreground'
									: 'text-muted-foreground/70 hover:text-foreground'
							}`}
						>
							<Globe2 className="h-4 w-4" />
						</button>
					</div>
				</div>
				<div className="h-12 min-w-0 flex-1 flex overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-hide">
					{visibleTabs.map((tab) => {
						const isActive = tab.id === activeTab.id;
						const activityKind = getTabActivityKind(tab);
						return (
							<div
								key={tab.id}
								className={`group h-12 w-44 max-w-56 shrink-0 px-3 border-r border-sidebar-border flex items-center gap-2 text-left transition-colors ${
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

			<div className="flex-1 min-h-0 overflow-hidden">
				{activeTab ? (
					renderTabContent(activeTab, closeTab, updateSessionFileOperationIndex)
				) : (
					<div className="flex h-full items-center justify-center bg-sidebar text-muted-foreground/60 text-sm">
						{activeMode === 'work'
							? 'No work tabs open'
							: 'No preview tabs open'}
					</div>
				)}
			</div>
		</section>
	);
});
