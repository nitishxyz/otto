import { create } from 'zustand';
import { useGitStore } from './gitStore';
import { useSessionFilesStore } from './sessionFilesStore';
import { useResearchStore } from './researchStore';
import { useSettingsStore } from './settingsStore';
import { useTunnelStore } from './tunnelStore';
import { useFileBrowserStore } from './fileBrowserStore';
import { useSkillsStore } from './skillsStore';

export type MCPScope = 'global' | 'project';

export type MCPSourceKind = 'user' | 'plugin';

export interface MCPServerInfo {
	name: string;
	transport: string;
	command?: string;
	args: string[];
	url?: string;
	env?: Record<string, string>;
	headers?: Record<string, string>;
	disabled: boolean;
	connected: boolean;
	tools: string[];
	error?: string;
	authRequired: boolean;
	authenticated: boolean;
	scope: MCPScope;
	authType?: string;
	sourceKind?: MCPSourceKind;
	sourcePlugin?: string;
	sourceLabel?: string;
	managedByPlugin?: boolean;
	overridesPlugin?: string;
}

export interface CopilotDeviceInfo {
	sessionId: string;
	userCode: string;
	verificationUri: string;
	interval: number;
	serverName: string;
}

interface MCPState {
	isExpanded: boolean;
	servers: MCPServerInfo[];
	loading: Set<string>;
	authUrls: Map<string, string>;
	copilotDevice: CopilotDeviceInfo | null;

	toggleSidebar: () => void;
	expandSidebar: () => void;
	collapseSidebar: () => void;
	setServers: (servers: MCPServerInfo[]) => void;
	setLoading: (name: string, loading: boolean) => void;
	updateServer: (name: string, updates: Partial<MCPServerInfo>) => void;
	setAuthUrl: (name: string, url: string | null) => void;
	setCopilotDevice: (info: CopilotDeviceInfo | null) => void;
}

export const useMCPStore = create<MCPState>((set) => ({
	isExpanded: false,
	servers: [],
	loading: new Set(),
	authUrls: new Map(),
	copilotDevice: null,

	toggleSidebar: () => {
		set((state) => {
			const newExpanded = !state.isExpanded;
			if (newExpanded) {
				useGitStore.getState().collapseSidebar();
				useSessionFilesStore.getState().collapseSidebar();
				useResearchStore.getState().collapseSidebar();
				useSettingsStore.getState().collapseSidebar();
				useTunnelStore.getState().collapseSidebar();
				useFileBrowserStore.getState().collapseSidebar();
				useSkillsStore.getState().collapseSidebar();
			}
			return { isExpanded: newExpanded };
		});
	},

	expandSidebar: () => {
		useGitStore.getState().collapseSidebar();
		useSessionFilesStore.getState().collapseSidebar();
		useResearchStore.getState().collapseSidebar();
		useSettingsStore.getState().collapseSidebar();
		useTunnelStore.getState().collapseSidebar();
		useFileBrowserStore.getState().collapseSidebar();
		useSkillsStore.getState().collapseSidebar();
		set({ isExpanded: true });
	},

	collapseSidebar: () => set({ isExpanded: false }),

	setServers: (servers) => set({ servers }),

	setLoading: (name, loading) =>
		set((state) => {
			const next = new Set(state.loading);
			if (loading) next.add(name);
			else next.delete(name);
			return { loading: next };
		}),

	updateServer: (name, updates) =>
		set((state) => ({
			servers: state.servers.map((s) =>
				s.name === name ? { ...s, ...updates } : s,
			),
		})),

	setAuthUrl: (name, url) =>
		set((state) => {
			const next = new Map(state.authUrls);
			if (url) next.set(name, url);
			else next.delete(name);
			return { authUrls: next };
		}),

	setCopilotDevice: (info) => set({ copilotDevice: info }),
}));
