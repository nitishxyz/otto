import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useGitStore } from './gitStore';
import { useSessionFilesStore } from './sessionFilesStore';
import { useSettingsStore } from './settingsStore';
import { useResearchStore } from './researchStore';
import { useTunnelStore } from './tunnelStore';
import { useFileBrowserStore } from './fileBrowserStore';
import { useMCPStore } from './mcpStore';
import { useSkillsStore } from './skillsStore';

export type BrowserPanelTabKind = 'web' | 'simulator';
export type BrowserPanelTabStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface BrowserPanelTab {
	id: string;
	kind: BrowserPanelTabKind;
	title: string;
	url: string;
	status: BrowserPanelTabStatus;
	createdBy: 'user' | 'llm';
}

interface OpenBrowserTabOptions {
	url?: string;
	title?: string;
	kind?: BrowserPanelTabKind;
	createdBy?: 'user' | 'llm';
	select?: boolean;
}

interface BrowserPanelState {
	isExpanded: boolean;
	tabs: BrowserPanelTab[];
	activeTabId: string | null;

	toggleSidebar: () => void;
	expandSidebar: () => void;
	collapseSidebar: () => void;
	openTab: (options?: OpenBrowserTabOptions) => string;
	closeTab: (tabId: string) => void;
	selectTab: (tabId: string) => void;
	updateTab: (
		tabId: string,
		updates: Partial<Omit<BrowserPanelTab, 'id'>>,
	) => void;
	setTabStatus: (tabId: string, status: BrowserPanelTabStatus) => void;
}

const DEFAULT_URL = 'about:blank';

function createTabId() {
	return `browser-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function inferTitle(url: string, fallback?: string) {
	if (fallback) return fallback;
	if (!url || url === DEFAULT_URL) return 'New Tab';
	try {
		const parsed = new URL(url);
		return parsed.hostname || url;
	} catch {
		return url;
	}
}

function collapseOtherRightPanels() {
	useGitStore.getState().collapseSidebar();
	useSessionFilesStore.getState().collapseSidebar();
	useSettingsStore.getState().collapseSidebar();
	useResearchStore.getState().collapseSidebar();
	useTunnelStore.getState().collapseSidebar();
	useFileBrowserStore.getState().collapseSidebar();
	useMCPStore.getState().collapseSidebar();
	useSkillsStore.getState().collapseSidebar();
}

export const useBrowserPanelStore = create<BrowserPanelState>()(
	persist(
		(set, get) => ({
			isExpanded: false,
			tabs: [],
			activeTabId: null,

			toggleSidebar: () => {
				set((state) => {
					const isExpanded = !state.isExpanded;
					if (isExpanded) collapseOtherRightPanels();
					return { isExpanded };
				});
			},

			expandSidebar: () => {
				collapseOtherRightPanels();
				set({ isExpanded: true });
			},

			collapseSidebar: () => set({ isExpanded: false }),

			openTab: (options = {}) => {
				const url = options.url ?? DEFAULT_URL;
				const tab: BrowserPanelTab = {
					id: createTabId(),
					kind: options.kind ?? 'web',
					title: inferTitle(url, options.title),
					url,
					status: 'idle',
					createdBy: options.createdBy ?? 'user',
				};

				set((state) => ({
					tabs: [...state.tabs, tab],
					activeTabId: options.select === false ? state.activeTabId : tab.id,
					isExpanded: true,
				}));
				collapseOtherRightPanels();
				return tab.id;
			},

			closeTab: (tabId) => {
				set((state) => {
					const tabIndex = state.tabs.findIndex((tab) => tab.id === tabId);
					const tabs = state.tabs.filter((tab) => tab.id !== tabId);
					let activeTabId = state.activeTabId;

					if (activeTabId === tabId) {
						activeTabId =
							tabs[tabIndex]?.id ??
							tabs[tabIndex - 1]?.id ??
							tabs[0]?.id ??
							null;
					}

					return {
						tabs,
						activeTabId,
						isExpanded: tabs.length > 0 ? state.isExpanded : false,
					};
				});
			},

			selectTab: (tabId) => {
				if (!get().tabs.some((tab) => tab.id === tabId)) return;
				set({ activeTabId: tabId, isExpanded: true });
				collapseOtherRightPanels();
			},

			updateTab: (tabId, updates) => {
				set((state) => ({
					tabs: state.tabs.map((tab) => {
						if (tab.id !== tabId) return tab;
						const nextUrl = updates.url ?? tab.url;
						return {
							...tab,
							...updates,
							title:
								updates.title ??
								(updates.url ? inferTitle(nextUrl) : tab.title),
						};
					}),
				}));
			},

			setTabStatus: (tabId, status) => {
				get().updateTab(tabId, { status });
			},
		}),
		{
			name: 'browser-panel-state',
			partialize: (state) => ({
				isExpanded: state.isExpanded,
				tabs: state.tabs,
				activeTabId: state.activeTabId,
			}),
		},
	),
);

const rightPanelStores = [
	useGitStore,
	useSessionFilesStore,
	useSettingsStore,
	useResearchStore,
	useTunnelStore,
	useFileBrowserStore,
	useMCPStore,
	useSkillsStore,
];

for (const store of rightPanelStores) {
	store.subscribe((state) => {
		if (state.isExpanded) {
			useBrowserPanelStore.getState().collapseSidebar();
		}
	});
}
