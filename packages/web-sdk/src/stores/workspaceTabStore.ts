import { create } from 'zustand';

type WorkspaceTabId = 'agents' | 'looper';

interface WorkspaceTabState {
	/** Last active session id per workspace tab (in-memory only). */
	lastSessionByTab: Partial<Record<WorkspaceTabId, string>>;
	setLastSession: (tab: WorkspaceTabId, sessionId: string) => void;
	clearLastSession: (tab: WorkspaceTabId) => void;
}

/**
 * Remembers the last visited session per workspace tab (agents | looper) so
 * switching tabs returns to where you were instead of the new-session view.
 */
export const useWorkspaceTabStore = create<WorkspaceTabState>((set) => ({
	lastSessionByTab: {},
	setLastSession: (tab, sessionId) =>
		set((state) => ({
			lastSessionByTab: { ...state.lastSessionByTab, [tab]: sessionId },
		})),
	clearLastSession: (tab) =>
		set((state) => {
			const next = { ...state.lastSessionByTab };
			delete next[tab];
			return { lastSessionByTab: next };
		}),
}));
