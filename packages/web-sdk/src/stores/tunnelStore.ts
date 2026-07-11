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

/**
 * Each (scope, mode) pair has its own slot so status polls for one mode can
 * never overwrite another. The managed remote-control slot is the single
 * source of truth for whole-machine remote access; quick tunnels and quick
 * project shares live in their own slots.
 */
export type TunnelSlotKey = 'remoteManaged' | 'remoteQuick' | 'projectShare';

export interface TunnelSlotState {
	status: TunnelStatus;
	url: string | null;
	error: string | null;
	progress: string | null;
	hostname: string | null;
}

/** Maps a tunnel scope + mode onto its dedicated store slot. */
export function tunnelSlotKey(
	scope: TunnelScope,
	mode?: TunnelMode,
): TunnelSlotKey {
	if (scope === 'project-share') return 'projectShare';
	return mode === 'managed' ? 'remoteManaged' : 'remoteQuick';
}

function createSlotState(): TunnelSlotState {
	return {
		status: 'idle',
		url: null,
		error: null,
		progress: null,
		hostname: null,
	};
}

interface TunnelState {
	isExpanded: boolean;
	remoteManaged: TunnelSlotState;
	remoteQuick: TunnelSlotState;
	projectShare: TunnelSlotState;
	ottorouterConnected: boolean;

	toggleSidebar: () => void;
	expandSidebar: () => void;
	collapseSidebar: () => void;
	patchSlot: (key: TunnelSlotKey, patch: Partial<TunnelSlotState>) => void;
	resetSlot: (key: TunnelSlotKey) => void;
	setOttorouterConnected: (connected: boolean) => void;
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
	remoteManaged: createSlotState(),
	remoteQuick: createSlotState(),
	projectShare: createSlotState(),
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

	patchSlot: (key, patch) =>
		set((state) => ({ [key]: { ...state[key], ...patch } })),

	resetSlot: (key) => set(() => ({ [key]: createSlotState() })),

	setOttorouterConnected: (connected) =>
		set({ ottorouterConnected: connected }),
}));
