import { useEffect, useCallback } from 'react';
import { useFocusStore } from '../stores/focusStore';
import { useSidebarStore } from '../stores/sidebarStore';
import { useGitStore } from '../stores/gitStore';
import { useSessionFilesStore } from '../stores/sessionFilesStore';
import { useFileBrowserStore } from '../stores/fileBrowserStore';
import { useTunnelStore } from '../stores/tunnelStore';
import { useMCPStore } from '../stores/mcpStore';
import { useSkillsStore } from '../stores/skillsStore';
import { useAgentsStore } from '../stores/agentsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useResearchStore } from '../stores/researchStore';
import { useFilePickerStore } from '../stores/filePickerStore';
import { useViewerTabsStore } from '../stores/viewerTabsStore';
import { useToggleTerminalTabs } from './useTerminalTabs';

/** Right rail panels in visual top-to-bottom order for Cmd/Ctrl+J/K cycling. */
const RIGHT_PANEL_ORDER = [
	'git',
	'session-files',
	'file-browser',
	'tunnel',
	'mcp',
	'skills',
	'settings',
] as const;

type RightPanelId = (typeof RIGHT_PANEL_ORDER)[number];

function getOpenRightPanelId(): RightPanelId | null {
	if (useGitStore.getState().isExpanded) return 'git';
	if (useSessionFilesStore.getState().isExpanded) return 'session-files';
	if (useFileBrowserStore.getState().isExpanded) return 'file-browser';
	if (useTunnelStore.getState().isExpanded) return 'tunnel';
	if (useMCPStore.getState().isExpanded) return 'mcp';
	if (useSkillsStore.getState().isExpanded) return 'skills';
	if (useSettingsStore.getState().isExpanded) return 'settings';
	return null;
}

/** Opens a right panel exclusively (each toggle collapses its siblings). */
function expandRightPanel(id: RightPanelId) {
	switch (id) {
		case 'git':
			if (!useGitStore.getState().isExpanded)
				useGitStore.getState().toggleSidebar();
			break;
		case 'session-files':
			if (!useSessionFilesStore.getState().isExpanded)
				useSessionFilesStore.getState().toggleSidebar();
			break;
		case 'file-browser':
			if (!useFileBrowserStore.getState().isExpanded)
				useFileBrowserStore.getState().toggleSidebar();
			break;
		case 'tunnel':
			if (!useTunnelStore.getState().isExpanded)
				useTunnelStore.getState().toggleSidebar();
			break;
		case 'mcp':
			if (!useMCPStore.getState().isExpanded)
				useMCPStore.getState().toggleSidebar();
			break;
		case 'skills':
			if (!useSkillsStore.getState().isExpanded)
				useSkillsStore.getState().toggleSidebar();
			break;
		case 'settings':
			if (!useSettingsStore.getState().isExpanded)
				useSettingsStore.getState().toggleSidebar();
			break;
	}
}

function collapseAllRightPanels() {
	useGitStore.getState().collapseSidebar();
	useSessionFilesStore.getState().collapseSidebar();
	useFileBrowserStore.getState().collapseSidebar();
	useTunnelStore.getState().collapseSidebar();
	useMCPStore.getState().collapseSidebar();
	useSkillsStore.getState().collapseSidebar();
	useSettingsStore.getState().collapseSidebar();
}

function isViewerPaneVisible(): boolean {
	const state = useViewerTabsStore.getState();
	return state.tabs.length > 0 && !state.isCollapsed;
}

function focusViewerPaneElement() {
	const viewerPane = document.querySelector<HTMLElement>('[data-viewer-pane]');
	if (!viewerPane) return;

	// Terminals use a hidden textarea (native renderer) or an xterm-generated
	// textarea. Focus it directly so pane navigation is immediately ready for
	// typing rather than requiring a follow-up click.
	const visibleTerminalInput = [
		...viewerPane.querySelectorAll<HTMLTextAreaElement>(
			'[data-terminal-viewer] textarea',
		),
	].find((input) => {
		const terminal = input.closest<HTMLElement>('[data-terminal-viewer]');
		return (
			terminal &&
			getComputedStyle(terminal).visibility !== 'hidden' &&
			input.getClientRects().length > 0
		);
	});
	if (visibleTerminalInput) {
		visibleTerminalInput.focus({ preventScroll: true });
		return;
	}

	viewerPane.focus({ preventScroll: true });
}

interface UseKeyboardShortcutsOptions {
	sessionIds?: string[];
	getSessionIds?: () => string[];
	activeSessionId?: string;
	onSelectSession: (sessionId: string) => void;
	onNewSession: () => void;
	onStageFile?: (paths: string[]) => void;
	onUnstageFile?: (paths: string[]) => void;
	onRestoreFile?: (path: string) => void;
	onDeleteFile?: (path: string) => void;
	onStageAll?: () => void;
	onUnstageAll?: () => void;
	onOpenCommitModal?: () => void;
	onViewDiff?: (file: string, staged: boolean) => void;
	onReturnToInput?: () => void;
}

export function useKeyboardShortcuts({
	sessionIds = [],
	getSessionIds,
	activeSessionId,
	onSelectSession,
	onNewSession,
	onStageFile,
	onUnstageFile,
	onRestoreFile,
	onDeleteFile,
	onStageAll,
	onUnstageAll,
	onOpenCommitModal,
	onViewDiff,
	onReturnToInput,
}: UseKeyboardShortcutsOptions) {
	const {
		currentFocus,
		sessionIndex,
		gitFileIndex,
		setFocus,
		setSessionIndex,
		setGitFileIndex,
		resetGitFileIndex,
	} = useFocusStore();
	const {
		setCollapsed: setSessionListCollapsed,
		toggleCollapse: toggleSessionList,
	} = useSidebarStore();
	const { isExpanded: isGitExpanded, toggleSidebar: toggleGit } = useGitStore();
	const closeDiff = useGitStore((state) => state.closeDiff);
	const gitTreeRows = useGitStore((state) => state.gitTreeRows);
	const toggleSessionFiles = useSessionFilesStore(
		(state) => state.toggleSidebar,
	);
	const toggleFileBrowser = useFileBrowserStore((state) => state.toggleSidebar);
	const toggleTunnel = useTunnelStore((state) => state.toggleSidebar);
	const toggleMCP = useMCPStore((state) => state.toggleSidebar);
	const toggleSkills = useSkillsStore((state) => state.toggleSidebar);
	const toggleAgents = useAgentsStore((state) => state.toggleManager);
	const toggleSettings = useSettingsStore((state) => state.toggleSidebar);
	const toggleResearch = useResearchStore((state) => state.toggleSidebar);
	const toggleTerminalTabs = useToggleTerminalTabs();

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const isInInput =
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable;
			const isInTerminal = !!target.closest('[data-terminal-viewer]');
			const isShortcutModifierPressed = e.ctrlKey || e.metaKey;
			// Plain Ctrl chords (no Cmd) are meaningful inside terminals
			// (Ctrl+H/J/K/L etc.), so pane navigation must not swallow them.
			const isTerminalCtrlChord = isInTerminal && e.ctrlKey && !e.metaKey;
			const latestSessionIds = getSessionIds?.() ?? sessionIds;
			const currentSessionIndex = latestSessionIds.indexOf(
				activeSessionId || '',
			);

			if (
				!isShortcutModifierPressed &&
				!e.shiftKey &&
				!e.altKey &&
				e.key === '/' &&
				!isInInput &&
				!isInTerminal
			) {
				e.preventDefault();
				(document.activeElement as HTMLElement)?.blur();
				setFocus('input');
				onReturnToInput?.();
				return;
			}

			if (
				isShortcutModifierPressed &&
				!e.shiftKey &&
				!e.altKey &&
				e.key >= '1' &&
				e.key <= '9'
			) {
				e.preventDefault();

				switch (e.key) {
					case '1':
						toggleGit();
						if (isGitExpanded && currentFocus === 'git') {
							setFocus('input');
						} else {
							setFocus('git');
							resetGitFileIndex();
						}
						break;
					case '2':
						toggleSessionFiles();
						setFocus('input');
						break;
					case '3':
						toggleFileBrowser();
						setFocus('input');
						break;
					case '4':
						{
							const viewerTabs = useViewerTabsStore.getState();
							const browserTab = viewerTabs.tabOrder
								.map((id) => viewerTabs.tabsById[id])
								.find((tab) => tab?.type === 'browser');
							if (browserTab?.id === viewerTabs.activeTabId) {
								viewerTabs.closeTab(browserTab.id);
							} else if (browserTab) {
								viewerTabs.setActiveTab(browserTab.id);
							} else {
								viewerTabs.openBrowserTab();
							}
						}
						setFocus('input');
						break;
					case '5':
						toggleTunnel();
						setFocus('input');
						break;
					case '6':
						toggleMCP();
						setFocus('input');
						break;
					case '7':
						toggleSkills();
						setFocus('input');
						break;
					case '8':
						toggleAgents();
						setFocus('input');
						break;
					case '9':
						toggleSettings();
						setFocus('input');
						break;
				}

				return;
			}

			if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
				e.preventDefault();

				// Ctrl+B: center -> left, left -> center, right -> center
				if (currentFocus === 'sessions') {
					// Already on sessions, go back to center
					(document.activeElement as HTMLElement)?.blur();
					setFocus('input');
					setSessionListCollapsed(true);
					// Focus the input after a small delay to ensure sidebar is collapsing
					setTimeout(() => onReturnToInput?.(), 50);
				} else if (currentFocus === 'git') {
					// On right sidebar, go back to center (don't jump to left)
					(document.activeElement as HTMLElement)?.blur();
					setFocus('input');
					toggleGit();
					closeDiff();
					setTimeout(() => onReturnToInput?.(), 50);
				} else {
					// From center, go to left sidebar
					(document.activeElement as HTMLElement)?.blur();
					setFocus('sessions');
					setSessionListCollapsed(false);
					if (currentSessionIndex >= 0) {
						setSessionIndex(currentSessionIndex);
					}
				}
				return;
			}

			if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'r') {
				e.preventDefault();

				// Ctrl+R: toggle the right panel. Closes whichever right panel
				// is open (even if it was opened manually); opens git otherwise.
				(document.activeElement as HTMLElement)?.blur();
				if (getOpenRightPanelId()) {
					collapseAllRightPanels();
					closeDiff();
					setFocus('input');
					// Focus the input after a small delay to ensure sidebar is collapsing
					setTimeout(() => onReturnToInput?.(), 50);
				} else {
					expandRightPanel('git');
					setFocus('git');
					resetGitFileIndex();
				}
				return;
			}

			// Ctrl+H / Ctrl+L: vim-style pane focus movement across whatever is
			// visible: sessions <-> chat <-> viewer (when open) <-> right panel.
			// Pushing past an edge opens that sidebar; pushing again at the edge
			// closes it.
			if (
				isShortcutModifierPressed &&
				!e.shiftKey &&
				!e.altKey &&
				!isTerminalCtrlChord &&
				(e.key === 'h' || e.key === 'l')
			) {
				e.preventDefault();
				e.stopPropagation();
				const blurActive = () =>
					(document.activeElement as HTMLElement)?.blur();
				const focusChat = () => {
					blurActive();
					setFocus('input');
					setTimeout(() => onReturnToInput?.(), 50);
				};
				const focusViewer = () => {
					blurActive();
					setFocus('viewer');
					setTimeout(focusViewerPaneElement, 0);
				};
				const focusRightPanel = (panel: RightPanelId) => {
					blurActive();
					if (panel === 'git') {
						setFocus('git');
						resetGitFileIndex();
					} else {
						setFocus('rightPanel');
					}
				};
				const viewerVisible = isViewerPaneVisible();
				const openRightPanel = getOpenRightPanelId();
				const onRightPanel =
					currentFocus === 'git' || currentFocus === 'rightPanel';

				if (e.key === 'h') {
					if (onRightPanel) {
						if (viewerVisible) focusViewer();
						else focusChat();
					} else if (currentFocus === 'viewer') {
						focusChat();
					} else if (currentFocus === 'sessions') {
						// Already at the leftmost pane: close the sidebar
						setSessionListCollapsed(true);
						focusChat();
					} else {
						// From chat, open (if needed) and focus the left sidebar
						blurActive();
						setSessionListCollapsed(false);
						setFocus('sessions');
						if (currentSessionIndex >= 0) {
							setSessionIndex(currentSessionIndex);
						}
					}
					return;
				}

				// 'l': move focus one pane to the right
				if (currentFocus === 'sessions') {
					focusChat();
				} else if (onRightPanel) {
					// Already at the rightmost pane: close the panel
					collapseAllRightPanels();
					closeDiff();
					if (viewerVisible) focusViewer();
					else focusChat();
				} else if (currentFocus === 'viewer') {
					if (openRightPanel) {
						focusRightPanel(openRightPanel);
					} else {
						expandRightPanel('git');
						focusRightPanel('git');
					}
				} else if (viewerVisible) {
					focusViewer();
				} else if (openRightPanel) {
					focusRightPanel(openRightPanel);
				} else {
					expandRightPanel('git');
					focusRightPanel('git');
				}
				return;
			}

			if ((e.ctrlKey || e.metaKey) && e.key === '/') {
				e.preventDefault();
				toggleSessionList();
				return;
			}

			if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
				e.preventDefault();
				toggleGit();
				return;
			}

			// Ctrl+J / Ctrl+K: with a right panel open, cycle up/down through
			// the right rail panels. With none open, Ctrl+J toggles terminals.
			if (
				isShortcutModifierPressed &&
				!e.shiftKey &&
				!e.altKey &&
				!isTerminalCtrlChord &&
				(e.key === 'j' || e.key === 'k')
			) {
				const openRightPanel = getOpenRightPanelId();
				if (openRightPanel) {
					e.preventDefault();
					e.stopPropagation();
					const index = RIGHT_PANEL_ORDER.indexOf(openRightPanel);
					const delta = e.key === 'j' ? 1 : -1;
					const next =
						RIGHT_PANEL_ORDER[
							(index + delta + RIGHT_PANEL_ORDER.length) %
								RIGHT_PANEL_ORDER.length
						];
					expandRightPanel(next);
					(document.activeElement as HTMLElement)?.blur();
					if (next === 'git') {
						setFocus('git');
						resetGitFileIndex();
					} else {
						setFocus('rightPanel');
					}
					return;
				}
				if (e.key === 'j') {
					e.preventDefault();
					void toggleTerminalTabs();
					return;
				}
			}

			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'r') {
				e.preventDefault();
				toggleResearch();
				return;
			}

			if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
				e.preventDefault();
				onNewSession();
				return;
			}

			if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
				e.preventDefault();
				useFilePickerStore.getState().toggle();
				return;
			}

			// Only handle q when not in input and a side pane is focused
			if (
				(e.key === 'Escape' && !isInTerminal) ||
				(e.key === 'q' &&
					!isInInput &&
					(currentFocus === 'sessions' ||
						currentFocus === 'git' ||
						currentFocus === 'rightPanel' ||
						currentFocus === 'viewer'))
			) {
				e.preventDefault();
				// Close sidebar if focused on one (the viewer stays open)
				if (currentFocus === 'sessions') {
					setSessionListCollapsed(true);
				} else if (currentFocus === 'git' || currentFocus === 'rightPanel') {
					collapseAllRightPanels();
					closeDiff();
				}
				setFocus('input');
				onReturnToInput?.();
				return;
			}

			if (currentFocus === 'sessions' && !isInInput) {
				if (e.key === 'j' && latestSessionIds.length > 0) {
					e.preventDefault();
					const nextIndex = Math.min(
						sessionIndex + 1,
						latestSessionIds.length - 1,
					);
					setSessionIndex(nextIndex);
					return;
				}

				if (e.key === 'k' && latestSessionIds.length > 0) {
					e.preventDefault();
					const prevIndex = Math.max(sessionIndex - 1, 0);
					setSessionIndex(prevIndex);
					return;
				}

				if (e.key === 'Enter' && latestSessionIds[sessionIndex]) {
					e.preventDefault();
					onSelectSession(latestSessionIds[sessionIndex]);
					setFocus('input');
					return;
				}
			}

			if (currentFocus === 'git' && !isInInput) {
				const focusedGitRow = gitTreeRows[gitFileIndex];

				if (e.key === 'j' && gitTreeRows.length > 0) {
					e.preventDefault();
					const nextIndex = Math.min(gitFileIndex + 1, gitTreeRows.length - 1);
					setGitFileIndex(nextIndex);
					return;
				}

				if (e.key === 'k' && gitTreeRows.length > 0) {
					e.preventDefault();
					const prevIndex = Math.max(gitFileIndex - 1, 0);
					setGitFileIndex(prevIndex);
					return;
				}

				if (e.key === ' ' && focusedGitRow) {
					e.preventDefault();
					if (focusedGitRow.staged) {
						onUnstageFile?.(focusedGitRow.actionPaths);
					} else {
						onStageFile?.(focusedGitRow.actionPaths);
					}
					return;
				}

				if (e.key === 'a') {
					e.preventDefault();
					onStageAll?.();
					return;
				}

				if (e.key === 'u') {
					e.preventDefault();
					onUnstageAll?.();
					return;
				}

				if (e.key === 'R' && focusedGitRow?.type === 'file') {
					e.preventDefault();
					// Only allow restore for unstaged, tracked files (not new/untracked)
					const canRestore =
						!focusedGitRow.staged &&
						focusedGitRow.status !== 'untracked' &&
						focusedGitRow.status !== 'added';
					if (canRestore) {
						onRestoreFile?.(focusedGitRow.path);
					}
					return;
				}

				// Delete file - Shift+D or Delete (only for untracked files)
				if ((e.shiftKey && e.key === 'D') || e.key === 'Backspace') {
					e.preventDefault();
					if (
						focusedGitRow?.type === 'file' &&
						!focusedGitRow.staged &&
						focusedGitRow.status === 'untracked'
					) {
						onDeleteFile?.(focusedGitRow.path);
					}
					return;
				}

				if (e.key === 'c') {
					e.preventDefault();
					onOpenCommitModal?.();
					return;
				}

				if (e.key === 'Enter' && focusedGitRow) {
					e.preventDefault();
					if (focusedGitRow.type === 'folder') {
						focusedGitRow.toggleExpanded?.();
					} else {
						focusedGitRow.open?.();
						onViewDiff?.(focusedGitRow.path, focusedGitRow.staged);
					}
					return;
				}
			}
		},
		[
			currentFocus,
			sessionIndex,
			gitFileIndex,
			sessionIds,
			getSessionIds,
			activeSessionId,
			gitTreeRows,
			isGitExpanded,
			setFocus,
			setSessionIndex,
			setGitFileIndex,
			resetGitFileIndex,
			setSessionListCollapsed,
			toggleGit,
			toggleSessionFiles,
			toggleFileBrowser,
			toggleTunnel,
			toggleMCP,
			toggleSkills,
			toggleAgents,
			toggleSettings,
			toggleTerminalTabs,
			toggleResearch,
			toggleSessionList,
			onSelectSession,
			onNewSession,
			onStageFile,
			onUnstageFile,
			onRestoreFile,
			onDeleteFile,
			onStageAll,
			onUnstageAll,
			onOpenCommitModal,
			onViewDiff,
			onReturnToInput,
			closeDiff,
		],
	);

	useEffect(() => {
		window.addEventListener('keydown', handleKeyDown, true);
		return () => window.removeEventListener('keydown', handleKeyDown, true);
	}, [handleKeyDown]);

	return {
		currentFocus,
		sessionIndex,
		gitFileIndex,
	};
}
