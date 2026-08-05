import { create } from 'zustand';
import type { AgentDetail } from '../lib/api-client/config';
import type { AgentEditorPage } from '../components/agents/agentConstants';
import { useAppsStore } from './appsStore';
import { useFileBrowserStore } from './fileBrowserStore';
import { useGitStore } from './gitStore';
import { useMCPStore } from './mcpStore';
import { useResearchStore } from './researchStore';
import { useSessionFilesStore } from './sessionFilesStore';
import { useSettingsStore } from './settingsStore';
import { useSkillsStore } from './skillsStore';
import { useTunnelStore } from './tunnelStore';

export type AgentsManagerMode = 'library' | 'workspace';

interface AgentsState {
	/** Rail toggle highlight (manager open). */
	isExpanded: boolean;
	isManagerOpen: boolean;
	managerMode: AgentsManagerMode;
	editorPage: AgentEditorPage;
	agents: AgentDetail[];
	defaultAgent: string | null;
	selectedAgent: string | null;
	isCreateModalOpen: boolean;
	setManagerMode: (mode: AgentsManagerMode) => void;
	openManager: () => void;
	closeManager: () => void;
	toggleManager: () => void;
	setAgents: (agents: AgentDetail[], defaultAgent: string) => void;
	selectAgent: (agent: string | null) => void;
	backToList: () => void;
	openAgentInManager: (agent: string) => void;
	setEditorPage: (page: AgentEditorPage) => void;
	openCreateModal: () => void;
	closeCreateModal: () => void;
}

function collapseOtherRightPanels() {
	useGitStore.getState().collapseSidebar();
	useSessionFilesStore.getState().collapseSidebar();
	useResearchStore.getState().collapseSidebar();
	useSettingsStore.getState().collapseSidebar();
	useTunnelStore.getState().collapseSidebar();
	useFileBrowserStore.getState().collapseSidebar();
	useMCPStore.getState().collapseSidebar();
	useSkillsStore.getState().collapseSidebar();
	useAppsStore.getState().collapseSidebar();
}

export const useAgentsStore = create<AgentsState>((set) => ({
	isExpanded: false,
	isManagerOpen: false,
	managerMode: 'library',
	editorPage: 'overview',
	agents: [],
	defaultAgent: null,
	selectedAgent: null,
	isCreateModalOpen: false,

	setManagerMode: (mode) => set({ managerMode: mode }),

	openManager: () => {
		collapseOtherRightPanels();
		set({ isManagerOpen: true, isExpanded: true, managerMode: 'library' });
	},

	closeManager: () =>
		set({
			isManagerOpen: false,
			isExpanded: false,
			isCreateModalOpen: false,
			managerMode: 'library',
			editorPage: 'overview',
		}),

	toggleManager: () => {
		const open = useAgentsStore.getState().isManagerOpen;
		if (open) {
			useAgentsStore.getState().closeManager();
		} else {
			useAgentsStore.getState().openManager();
		}
	},

	setAgents: (agents, defaultAgent) =>
		set((state) => ({
			agents,
			defaultAgent,
			selectedAgent:
				state.selectedAgent &&
				agents.some((a) => a.name === state.selectedAgent)
					? state.selectedAgent
					: (agents.find((a) => a.name === defaultAgent)?.name ??
						agents[0]?.name ??
						null),
		})),

	selectAgent: (agent) => set({ selectedAgent: agent }),

	backToList: () => set({ selectedAgent: null, editorPage: 'overview' }),

	openAgentInManager: (agent) =>
		set({
			isManagerOpen: true,
			isExpanded: true,
			managerMode: 'workspace',
			selectedAgent: agent,
			editorPage: 'overview',
			isCreateModalOpen: false,
		}),

	setEditorPage: (page) => set({ editorPage: page }),

	openCreateModal: () =>
		set({ isManagerOpen: true, isExpanded: true, isCreateModalOpen: true }),

	closeCreateModal: () =>
		set({
			isCreateModalOpen: false,
			managerMode: 'library',
			editorPage: 'overview',
		}),
}));
