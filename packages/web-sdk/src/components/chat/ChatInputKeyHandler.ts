import type { KeyboardEvent } from 'react';
import type { VimMode } from '../../hooks/useVimMode';

interface ChatInputKeyHandlerOptions {
	showFileMention: boolean;
	showSkillMention: boolean;
	showCommandSuggestions: boolean;
	mentionSelectedIndex: number;
	skillMentionSelectedIndex: number;
	commandSelectedIndex: number;
	commandResultCount: number;
	commandMissingRequired: string[];
	commandStageKind: 'root' | 'namespace' | 'params';
	currentFileToSelect: string | undefined;
	currentSkillToSelect: string | undefined;
	currentCommandToSelect: string | undefined;
	agent: string | undefined;
	agents: string[];
	isPlanMode: boolean;
	vimModeEnabled: boolean;
	vimMode: VimMode;
	setMentionSelectedIndex: (index: number) => void;
	setSkillMentionSelectedIndex: (index: number) => void;
	setCommandSelectedIndex: (index: number) => void;
	setShowFileMention: (show: boolean) => void;
	setShowSkillMention: (show: boolean) => void;
	setShowCommandSuggestions: (show: boolean) => void;
	setIsPlanMode: (mode: boolean) => void;
	setVimMode: (mode: VimMode) => void;
	handleFileSelect: (file: string) => void;
	handleSkillSelect: (skill: string) => void;
	handleCommandSelect: (commandId: string) => void;
	handleSend: () => void;
	handleVimNormalMode: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
	onAgentChange?: (agent: string) => void;
	onPlanModeToggle?: (isPlanMode: boolean) => void;
}

export function createChatInputKeyHandler(options: ChatInputKeyHandlerOptions) {
	return (e: KeyboardEvent<HTMLTextAreaElement>) => {
		const {
			showFileMention,
			showSkillMention,
			showCommandSuggestions,
			mentionSelectedIndex,
			skillMentionSelectedIndex,
			commandSelectedIndex,
			commandResultCount,
			commandMissingRequired,
			commandStageKind,
			currentFileToSelect,
			currentSkillToSelect,
			currentCommandToSelect,
			agent,
			agents,
			isPlanMode,
			vimModeEnabled,
			vimMode,
			setMentionSelectedIndex,
			setSkillMentionSelectedIndex,
			setCommandSelectedIndex,
			setShowFileMention,
			setShowSkillMention,
			setShowCommandSuggestions,
			setIsPlanMode,
			setVimMode,
			handleFileSelect,
			handleSkillSelect,
			handleCommandSelect,
			handleSend,
			handleVimNormalMode,
			onAgentChange,
			onPlanModeToggle,
		} = options;

		if (e.key.toLowerCase() === 'g' && e.ctrlKey && agents.length > 0) {
			e.preventDefault();
			const currentIndex = agents.indexOf(agent ?? '');
			const nextIndex =
				currentIndex >= 0 ? (currentIndex + 1) % agents.length : 0;
			const nextAgent = agents[nextIndex];
			if (nextAgent) {
				onAgentChange?.(nextAgent);
			}
			return;
		}

		if (showCommandSuggestions) {
			const count = Math.max(commandResultCount, 1);
			if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
				e.preventDefault();
				setCommandSelectedIndex((commandSelectedIndex + 1) % count);
			} else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
				e.preventDefault();
				setCommandSelectedIndex((commandSelectedIndex - 1 + count) % count);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				// In the parameter stage, once required args are satisfied, Enter
				// sends the message rather than inserting another flag. If required
				// args are missing, keep focus and surface the popup guidance.
				if (commandStageKind === 'params') {
					if (commandMissingRequired.length === 0) {
						setShowCommandSuggestions(false);
						handleSend();
					}
				} else if (currentCommandToSelect) {
					handleCommandSelect(currentCommandToSelect);
				}
			} else if (e.key === 'Escape') {
				e.preventDefault();
				setShowCommandSuggestions(false);
			}
			return;
		}

		if (showSkillMention) {
			if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
				e.preventDefault();
				setSkillMentionSelectedIndex((skillMentionSelectedIndex + 1) % 12);
			} else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
				e.preventDefault();
				setSkillMentionSelectedIndex((skillMentionSelectedIndex - 1 + 12) % 12);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				if (currentSkillToSelect) {
					handleSkillSelect(currentSkillToSelect);
				} else {
					setShowSkillMention(false);
					handleSend();
				}
			} else if (e.key === 'Escape') {
				e.preventDefault();
				setShowSkillMention(false);
				if (vimModeEnabled) {
					setVimMode('normal');
				}
			}
			return;
		}

		if (showFileMention) {
			if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
				e.preventDefault();
				setMentionSelectedIndex((mentionSelectedIndex + 1) % 25);
			} else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
				e.preventDefault();
				setMentionSelectedIndex((mentionSelectedIndex - 1 + 25) % 25);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				if (currentFileToSelect) {
					handleFileSelect(currentFileToSelect);
				} else {
					setShowFileMention(false);
					handleSend();
				}
			} else if (e.key === 'Escape') {
				e.preventDefault();
				setShowFileMention(false);
				if (vimModeEnabled) {
					setVimMode('normal');
				}
			}
			return;
		}

		if (vimModeEnabled && vimMode === 'normal') {
			const handled = handleVimNormalMode(e);
			if (handled) return;
		}

		if (vimModeEnabled && vimMode === 'insert' && e.key === 'Escape') {
			e.preventDefault();
			setVimMode('normal');
			return;
		}

		if (e.key === 'Tab') {
			e.preventDefault();
			const newPlanMode = !isPlanMode;
			setIsPlanMode(newPlanMode);
			onPlanModeToggle?.(newPlanMode);
		} else if (
			e.key === 'Enter' &&
			!e.shiftKey &&
			(!vimModeEnabled || vimMode === 'normal')
		) {
			e.preventDefault();
			handleSend();
		}
	};
}
