import { useState, useCallback, useMemo } from 'react';
import { apiClient } from '../lib/api-client';
import {
	findPluginCommandEntry,
	getCommandLabel,
	getMissingRequiredParams,
	getRecipeCommandName,
	shouldSendSlashCommandAsMessage,
} from '../lib/commands';
import { usePluginCommands } from './usePluginCommands';
import { useViewerTabsStore } from '../stores/viewerTabsStore';

interface UseCommandSuggestionsOptions {
	onCommand?: (commandId: string) => void;
	onSendCommandMessage?: (message: string) => void | Promise<void>;
	updatePreferences: (prefs: { vimMode?: boolean }) => void;
	updateReasoningText: (enabled: boolean) => void;
	vimModeEnabled: boolean;
	reasoningEnabled: boolean;
	textareaRef: React.RefObject<HTMLTextAreaElement>;
	setMessage: (msg: string) => void;
	setShowShortcutsModal: (show: boolean) => void;
	sessionId?: string;
}

interface UseCommandSuggestionsReturn {
	showCommandSuggestions: boolean;
	commandQuery: string;
	commandSelectedIndex: number;
	commandResultCount: number;
	commandMissingRequired: string[];
	commandStageKind: 'root' | 'namespace' | 'params';
	currentCommandToSelect: string | undefined;
	setShowCommandSuggestions: (show: boolean) => void;
	setCommandQuery: (query: string) => void;
	setCommandSelectedIndex: (index: number) => void;
	setCommandResultCount: (count: number) => void;
	setCommandMissingRequired: (params: string[]) => void;
	setCommandStageKind: (kind: 'root' | 'namespace' | 'params') => void;
	setCurrentCommandToSelect: (commandId: string | undefined) => void;
	handleCommandSelect: (commandId: string) => void;
	handleCommandEnterSelect: (commandId: string | undefined) => void;
	checkForCommand: (value: string) => void;
}

export function useCommandSuggestions({
	onCommand,
	onSendCommandMessage,
	updatePreferences,
	updateReasoningText,
	vimModeEnabled,
	reasoningEnabled,
	textareaRef,
	setMessage,
	setShowShortcutsModal,
	sessionId,
}: UseCommandSuggestionsOptions): UseCommandSuggestionsReturn {
	const [showCommandSuggestions, setShowCommandSuggestions] = useState(false);
	const [commandQuery, setCommandQuery] = useState('');
	const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
	const [commandResultCount, setCommandResultCount] = useState(0);
	const [commandMissingRequired, setCommandMissingRequired] = useState<
		string[]
	>([]);
	const [commandStageKind, setCommandStageKind] = useState<
		'root' | 'namespace' | 'params'
	>('root');
	const [currentCommandToSelect, setCurrentCommandToSelect] = useState<
		string | undefined
	>();

	const { data: pluginCommandsData } = usePluginCommands();
	const pluginCommands = useMemo(
		() => pluginCommandsData?.commands ?? [],
		[pluginCommandsData?.commands],
	);
	const pluginNamespaces = useMemo(
		() => new Set(pluginCommands.map((entry) => entry.plugin)),
		[pluginCommands],
	);

	const focusTextarea = useCallback(() => {
		textareaRef.current?.focus();
	}, [textareaRef]);

	const handleCommandSelect = useCallback(
		async (commandId: string) => {
			const resetInput = () => {
				setMessage('');
				setShowCommandSuggestions(false);
				if (textareaRef.current) {
					textareaRef.current.style.height = 'auto';
				}
				textareaRef.current?.focus();
			};

			// Plugin namespace: narrow to the plugin's command list, do not execute.
			if (commandId.startsWith('plugin:')) {
				const namespace = commandId.slice('plugin:'.length);
				setMessage(`/${namespace} `);
				setCommandSelectedIndex(0);
				focusTextarea();
				return;
			}

			// Plugin command: open params if required args are missing, else send.
			if (commandId.startsWith('plugin-command:')) {
				const [namespace, command] = commandId
					.slice('plugin-command:'.length)
					.split(':');
				if (namespace && command) {
					const entry = findPluginCommandEntry(
						pluginCommands,
						namespace,
						command,
					);
					const base = `/${namespace} ${command}`;
					const missing = entry ? getMissingRequiredParams(entry, base) : [];
					const hasParams =
						entry && Object.keys(entry.parameters ?? {}).length > 0;
					if (missing.length > 0 || hasParams) {
						setMessage(`${base} `);
						setCommandSelectedIndex(0);
						focusTextarea();
						return;
					}
					if (onSendCommandMessage) {
						await onSendCommandMessage(base);
						resetInput();
						return;
					}
				}
				resetInput();
				return;
			}

			// Plugin parameter: append the flag to the current input.
			if (commandId.startsWith('plugin-param:')) {
				const parts = commandId.slice('plugin-param:'.length).split(':');
				const name = parts[2];
				if (name) {
					const current = textareaRef.current?.value ?? '';
					const next = current.endsWith(' ') ? current : `${current} `;
					setMessage(`${next}--${name} `);
					setCommandSelectedIndex(0);
					focusTextarea();
				}
				return;
			}

			if (commandId === 'help') {
				setShowShortcutsModal(true);
				resetInput();
				return;
			}
			if (commandId === 'vim') {
				updatePreferences({ vimMode: !vimModeEnabled });
				resetInput();
				return;
			}
			if (commandId === 'reasoning') {
				updateReasoningText(!reasoningEnabled);
				resetInput();
				return;
			}
			if (commandId === 'follow') {
				useViewerTabsStore.getState().toggleFollowToolActivity();
				resetInput();
				return;
			}
			if (commandId === 'stop') {
				if (sessionId) {
					try {
						await apiClient.abortSession(sessionId);
					} catch (error) {
						console.error('Failed to stop generation:', error);
					}
				}
				resetInput();
				return;
			}
			const recipeName = getRecipeCommandName(commandId);
			if (recipeName && onSendCommandMessage) {
				await onSendCommandMessage(`/${recipeName}`);
				resetInput();
				return;
			}
			if (shouldSendSlashCommandAsMessage(commandId)) {
				const label = getCommandLabel(commandId);
				if (label && onSendCommandMessage) {
					await onSendCommandMessage(label);
					resetInput();
					return;
				}
			}
			if (onCommand) {
				onCommand(commandId);
			}
			resetInput();
		},
		[
			onCommand,
			onSendCommandMessage,
			vimModeEnabled,
			reasoningEnabled,
			updatePreferences,
			updateReasoningText,
			textareaRef,
			setMessage,
			setShowShortcutsModal,
			sessionId,
			pluginCommands,
			focusTextarea,
		],
	);

	const handleCommandEnterSelect = useCallback(
		(commandId: string | undefined) => {
			setCurrentCommandToSelect(commandId);
		},
		[],
	);

	const checkForCommand = useCallback(
		(value: string) => {
			if (!value.startsWith('/')) {
				setShowCommandSuggestions(false);
				return;
			}
			const firstToken = value.slice(1).split(' ', 1)[0] ?? '';
			const hasSpace = value.includes(' ');
			// Keep the popup open past the first space only for plugin namespaces
			// so plugin command/parameter stages can be browsed.
			if (hasSpace && !pluginNamespaces.has(firstToken)) {
				setShowCommandSuggestions(false);
				return;
			}
			setShowCommandSuggestions(true);
			setCommandQuery(firstToken);
			setCommandSelectedIndex(0);
		},
		[pluginNamespaces],
	);

	return {
		showCommandSuggestions,
		commandQuery,
		commandSelectedIndex,
		commandResultCount,
		commandMissingRequired,
		commandStageKind,
		currentCommandToSelect,
		setShowCommandSuggestions,
		setCommandQuery,
		setCommandSelectedIndex,
		setCommandResultCount,
		setCommandMissingRequired,
		setCommandStageKind,
		setCurrentCommandToSelect,
		handleCommandSelect,
		handleCommandEnterSelect,
		checkForCommand,
	};
}
