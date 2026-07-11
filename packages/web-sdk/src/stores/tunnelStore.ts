import { create } from 'zustand';
import { useGitStore } from './gitStore';
import { useSessionFilesStore } from './sessionFilesStore';
import { useSettingsStore } from './settingsStore';
import { useResearchStore } from './researchStore';
import { useFileBrowserStore } from './fileBrowserStore';
import { useMCPStore } from './mcpStore';
import { useSkillsStore } from './skillsStore';

export type TunnelScope = 'remote-control' | 'project-share';
export type TunnelStatus = 'idle' | 'starting' | 'connected' | 'error';
export type TunnelMode = 'managed' | 'quick';

export interface TunnelScopeState {
	status: TunnelStatus;
	url: string | null;
	error: string | null;
	progress: string | null;
	mode: TunnelMode;
	hostname: string | null;
}

function createScopeState(): TunnelScopeState {
	return {
		status: 'idle',
		url: null,
		error: null,
		progress: null,
		mode: 'quick',
		hostname: null,
	};
}

interface TunnelState {
	isExpanded: boolean;
	remoteControl: TunnelScopeState;
	projectShare: TunnelScopeState;
	ottorouterConnected: boolean;

	toggleSidebar: () => void;
	expandSidebar: () => void;
	collapseSidebar: () => void;
	setScopeStatus: (scope: TunnelScope, status: TunnelStatus) => void;
	setScopeUrl: (scope: TunnelScope, url: string | null) => void;
	setScopeError: (scope: TunnelScope, error: string | null) => void;
	setScopeProgress: (scope: TunnelScope, progress: string | null) => void;
	patchScope: (scope: TunnelScope, patch: Partial<TunnelScopeState>) => void;
	resetScope: (scope: TunnelScope) => void;
	setOttorouterConnected: (connected: boolean) => void;
}

function scopeKey(scope: TunnelScope): 'remoteControl' | 'projectShare' {
	return scope === 'project-share' ? 'projectShare' : 'remoteControl';
}

function collapseOtherSidebars() {
	useGitStore.getState().collapseSidebar();
	useSessionFilesStore.getState().collapseSidebar();
	useSettingsStore.getState().collapseSidebar();
	useResearchStore.getState().collapseSidebar();
	useFileBrowserStore.getState().collapseSidebar();
	useMCPStore.getState().collapseSidebar();
	useSkillsStore.getState().collapseSidebar();
}

export const useTunnelStore = create<TunnelState>((set) => ({
	isExpanded: false,
	remoteControl: createScopeState(),
	projectShare: createScopeState(),
	ottorouterConnected: false,

	toggleSidebar: () => {
		set((state) => {
			const newExpanded = !state.isExpanded;
			if (newExpanded) collapseOtherSidebars();
			return { isExpanded: newExpanded };
		});
	},

	expandSidebar: () => {
		collapseOtherSidebars();
		set({ isExpanded: true });
	},

	collapseSidebar: () => set({ isExpanded: false }),

	setScopeStatus: (scope, status) =>
		set((state) => {
			const key = scopeKey(scope);
			return { [key]: { ...state[key], status } } as Partial<TunnelState>;
		}),

	setScopeUrl: (scope, url) =>
		set((state) => {
			const key = scopeKey(scope);
			return { [key]: { ...state[key], url } } as Partial<TunnelState>;
		}),

	setScopeError: (scope, error) =>
		set((state) => {
			const key = scopeKey(scope);
			return { [key]: { ...state[key], error } } as Partial<TunnelState>;
		}),

	setScopeProgress: (scope, progress) =>
		set((state) => {
			const key = scopeKey(scope);
			return { [key]: { ...state[key], progress } } as Partial<TunnelState>;
		}),

	patchScope: (scope, patch) =>
		set((state) => {
			const key = scopeKey(scope);
			return { [key]: { ...state[key], ...patch } } as Partial<TunnelState>;
		}),

	resetScope: (scope) =>
		set(
			() => ({ [scopeKey(scope)]: createScopeState() }) as Partial<TunnelState>,
		),

	setOttorouterConnected: (connected) =>
		set({ ottorouterConnected: connected }),
}));
