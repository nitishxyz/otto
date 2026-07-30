import { useCallback, useEffect } from 'react';
import {
	terminalViewerTabId,
	useViewerTabsStore,
} from '../stores/viewerTabsStore';
import { useCreateTerminal, useTerminals } from './useTerminals';

const DEFAULT_TERMINAL_PURPOSE = 'Manual shell';

function terminalTabLabel(terminal: { title: string; purpose: string }) {
	return terminal.title || terminal.purpose;
}

function getTerminalTabIds(): string[] {
	const state = useViewerTabsStore.getState();
	return state.tabOrder.filter((id) => state.tabsById[id]?.type === 'terminal');
}

/** Creates a new daemon terminal and opens it as a viewer tab. */
export function useOpenNewTerminalTab() {
	const createTerminal = useCreateTerminal();
	return useCallback(async () => {
		try {
			const result = await createTerminal.mutateAsync({
				command: 'bash',
				purpose: DEFAULT_TERMINAL_PURPOSE,
			});
			useViewerTabsStore
				.getState()
				.openTerminalTab(result.terminalId, DEFAULT_TERMINAL_PURPOSE);
		} catch {
			// ignore
		}
	}, [createTerminal]);
}

/**
 * Focuses the terminal viewer section: reuses open terminal tabs, opens tabs
 * for all running terminals, or creates a terminal when none exist.
 */
export function useOpenTerminalTabs() {
	const { data } = useTerminals();
	const openNewTerminalTab = useOpenNewTerminalTab();
	return useCallback(async () => {
		const terminalTabIds = getTerminalTabIds();
		if (terminalTabIds.length > 0) {
			useViewerTabsStore.getState().setActiveTab(terminalTabIds[0]);
			return;
		}

		const terminals = data?.terminals ?? [];
		if (terminals.length === 0) {
			await openNewTerminalTab();
			return;
		}
		for (const terminal of terminals) {
			useViewerTabsStore
				.getState()
				.openTerminalTab(terminal.id, terminalTabLabel(terminal));
		}
		useViewerTabsStore
			.getState()
			.setActiveTab(terminalViewerTabId(terminals[0].id));
	}, [data, openNewTerminalTab]);
}

/**
 * Toggles the terminal viewer section: hides terminal tabs when one is
 * active, otherwise focuses or opens them.
 */
export function useToggleTerminalTabs() {
	const openTerminalTabs = useOpenTerminalTabs();
	return useCallback(async () => {
		const state = useViewerTabsStore.getState();
		const activeTab = state.activeTabId
			? state.tabsById[state.activeTabId]
			: undefined;

		if (activeTab?.type === 'terminal') {
			for (const id of getTerminalTabIds()) {
				useViewerTabsStore.getState().closeTab(id);
			}
			return;
		}

		await openTerminalTabs();
	}, [openTerminalTabs]);
}

/** Keeps terminal viewer tabs in sync with daemon terminals (titles, removals). */
export function useSyncTerminalTabs(enabled: boolean) {
	const { data } = useTerminals();
	useEffect(() => {
		if (!enabled || !data) return;
		useViewerTabsStore.getState().syncTerminalTabs(
			data.terminals.map((terminal) => ({
				id: terminal.id,
				title: terminalTabLabel(terminal),
			})),
		);
	}, [enabled, data]);
}
