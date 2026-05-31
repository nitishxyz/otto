import {
	useState,
	useRef,
	useEffect,
	useCallback,
	memo,
	forwardRef,
	useImperativeHandle,
	useMemo,
} from 'react';
import type { ChangeEvent, ClipboardEvent } from 'react';

import {
	ArrowUp,
	MoreVertical,
	X,
	ImageIcon,
	Brain,
	FileText,
	FileIcon,
	FlaskConical,
	ChevronUp,
	Mic,
	Square,
} from 'lucide-react';
import { Textarea } from '../ui/Textarea';
import { LiveWaveform } from './LiveWaveform';
import { FileMentionPopup } from './FileMentionPopup';
import { SkillMentionPopup } from './SkillMentionPopup';
import { CommandSuggestionsPopup } from './CommandSuggestionsPopup';
import { ShortcutsModal } from './ShortcutsModal';
import { ProviderLogo } from '../common/ProviderLogo';
import { useFiles } from '../../hooks/useFiles';
import { useSkills } from '../../hooks/useSkills';
import { usePreferences } from '../../hooks/usePreferences';
import { useConfig, useUpdateDefaults } from '../../hooks/useConfig';
import { useVimMode } from '../../hooks/useVimMode';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useFileMention } from '../../hooks/useFileMention';
import { useSkillMention } from '../../hooks/useSkillMention';
import { useCommandSuggestions } from '../../hooks/useCommandSuggestions';
import { createChatInputKeyHandler } from './ChatInputKeyHandler';
import {
	findExactCommand,
	shouldSendSlashCommandAsMessage,
} from '../../lib/commands';
import { useOttoRouterStore } from '../../stores/ottorouterStore';
import type { FileAttachment } from '../../hooks/useFileUpload';
import { StableSpinner } from '../ui/StableSpinner';
import { InputApprovalBar } from './InputApprovalBar';
import { InputSecureInputBar } from './InputSecureInputBar';
import { InputQueueBar } from './InputQueueBar';
import { InputTodosBar } from './InputTodosBar';
import { DictationInstallPrompt } from './DictationInstallPrompt';

const VOICE_SHORTCUT_DOUBLE_PRESS_WINDOW_MS = 280;

function isGlobeKeyEvent(event: KeyboardEvent): boolean {
	return (
		event.key === 'Globe' ||
		event.key === 'Fn' ||
		event.key === 'Function' ||
		event.code === 'Globe' ||
		event.code === 'Fn' ||
		event.code === 'Function' ||
		event.keyCode === 63 ||
		event.which === 63
	);
}

function isWebVoiceShortcutDown(event: KeyboardEvent): boolean {
	return event.code === 'Space' && (event.ctrlKey || event.altKey);
}

function isWebVoiceShortcutUp(event: KeyboardEvent): boolean {
	return (
		event.code === 'Space' ||
		event.key === 'Control' ||
		event.key === 'Alt' ||
		event.code === 'ControlLeft' ||
		event.code === 'ControlRight' ||
		event.code === 'AltLeft' ||
		event.code === 'AltRight'
	);
}

interface ChatInputProps {
	onSend: (message: string) => void;
	onCommand?: (commandId: string) => void;
	disabled?: boolean;
	onConfigClick?: () => void;
	onPlanModeToggle?: (isPlanMode: boolean) => void;
	isPlanMode?: boolean;
	reasoningEnabled?: boolean;
	sessionId?: string;
	images?: FileAttachment[];
	documents?: FileAttachment[];
	onFileRemove?: (id: string) => void;
	isDragging?: boolean;
	onPaste?: (e: ClipboardEvent) => void;
	visionEnabled?: boolean;
	attachmentEnabled?: boolean;
	modelName?: string;
	providerName?: string;
	isCustomProvider?: boolean;
	authType?: 'api' | 'oauth' | 'wallet';
	isFreeModel?: boolean;
	researchContexts?: Array<{ id: string; label: string }>;
	onResearchContextRemove?: (id: string) => void;
	onModelInfoClick?: () => void;
	agent?: string;
	agents?: string[];
	onAgentChange?: (agent: string) => void;
}

export const ChatInput = memo(
	forwardRef<
		{ focus: () => void; setValue: (value: string) => void },
		ChatInputProps
	>(function ChatInput(
		{
			onSend,
			onCommand,
			disabled,
			onConfigClick,
			onPlanModeToggle,
			isPlanMode: externalIsPlanMode,
			reasoningEnabled,
			sessionId,
			images = [],
			documents = [],
			onFileRemove,
			isDragging = false,
			onPaste,
			visionEnabled = false,
			attachmentEnabled = false,
			modelName,
			providerName,
			isCustomProvider = false,
			authType,
			isFreeModel,
			researchContexts = [],
			onResearchContextRemove,
			onModelInfoClick,
			agent,
			agents = [],
			onAgentChange,
		},
		ref,
	) {
		const [message, setMessage] = useState('');
		const [isPlanMode, setIsPlanMode] = useState(externalIsPlanMode || false);
		const [showShortcutsModal, setShowShortcutsModal] = useState(false);
		const [showDictationInstallPrompt, setShowDictationInstallPrompt] =
			useState(false);
		const [showAgentDropdown, setShowAgentDropdown] = useState(false);
		const [voiceShortcutMode, setVoiceShortcutMode] = useState<
			'hold' | 'latched' | null
		>(null);
		const textareaRef = useRef<HTMLTextAreaElement>(null);
		const agentDropdownRef = useRef<HTMLDivElement>(null);

		const { preferences, updatePreferences } = usePreferences();
		const { data: configData } = useConfig();
		const updateDefaultsMutation = useUpdateDefaults();

		const ottorouterSubscription = useOttoRouterStore((s) => s.subscription);
		const isOttoRouter = providerName === 'ottorouter';
		const ottorouterPlanLabel = useMemo(() => {
			if (!isOttoRouter) return null;
			if (ottorouterSubscription?.active) {
				return ottorouterSubscription.tierName ?? 'GO';
			}
			return null;
		}, [isOttoRouter, ottorouterSubscription]);

		useEffect(() => {
			if (!showAgentDropdown) return;
			const handleClickOutside = (event: MouseEvent) => {
				if (
					agentDropdownRef.current &&
					!agentDropdownRef.current.contains(event.target as Node)
				) {
					setShowAgentDropdown(false);
				}
			};
			document.addEventListener('mousedown', handleClickOutside);
			return () =>
				document.removeEventListener('mousedown', handleClickOutside);
		}, [showAgentDropdown]);

		const handleSendRef = useRef<() => void>(() => {});

		const {
			showFileMention,
			mentionQuery,
			mentionSelectedIndex,
			currentFileToSelect,
			setShowFileMention,
			setMentionSelectedIndex,
			setCurrentFileToSelect,
			handleFileSelect: selectFile,
			handleEnterSelect: handleMentionEnterSelect,
			checkForMention,
		} = useFileMention();

		const {
			showSkillMention,
			skillMentionQuery,
			skillMentionSelectedIndex,
			currentSkillToSelect,
			setShowSkillMention,
			setSkillMentionSelectedIndex,
			setCurrentSkillToSelect,
			handleSkillSelect: selectSkill,
			handleEnterSelect: handleSkillEnterSelect,
			checkForSkillMention,
		} = useSkillMention();

		const { data: skillsConfig } = useSkills({ enabled: showSkillMention });
		const skillSummaries = skillsConfig?.items ?? [];

		const { data: filesData, isLoading: filesLoading } = useFiles({
			enabled: showFileMention,
			query: mentionQuery,
		});
		const files = filesData?.files || [];
		const changedFiles = filesData?.changedFiles || [];

		const {
			showCommandSuggestions,
			commandQuery,
			commandSelectedIndex,
			currentCommandToSelect,
			setShowCommandSuggestions,
			setCommandSelectedIndex,
			setCurrentCommandToSelect,
			handleCommandSelect,
			handleCommandEnterSelect,
			checkForCommand,
		} = useCommandSuggestions({
			onCommand,
			onSendCommandMessage: onSend,
			updatePreferences,
			updateReasoningText: (enabled: boolean) =>
				updateDefaultsMutation.mutate({
					reasoningText: enabled,
					scope: 'global',
				}),
			vimModeEnabled: preferences.vimMode,
			reasoningEnabled: configData?.defaults?.reasoningText ?? true,
			textareaRef,
			setMessage,
			setShowShortcutsModal,
			sessionId,
		});

		const { vimMode, setVimMode, handleVimNormalMode } = useVimMode({
			enabled: preferences.vimMode,
			onSend: () => handleSendRef.current(),
			textareaRef,
			setMessage,
		});

		const resetComposer = useCallback(() => {
			setMessage('');
			setShowFileMention(false);
			setShowSkillMention(false);
			setShowCommandSuggestions(false);
			setCurrentFileToSelect(undefined);
			setCurrentSkillToSelect(undefined);
			setCurrentCommandToSelect(undefined);

			if (textareaRef.current) {
				textareaRef.current.style.height = 'auto';
			}

			if (preferences.vimMode) {
				setVimMode('normal');
			}

			textareaRef.current?.focus();
		}, [
			preferences.vimMode,
			setShowFileMention,
			setShowSkillMention,
			setShowCommandSuggestions,
			setCurrentFileToSelect,
			setCurrentSkillToSelect,
			setCurrentCommandToSelect,
			setVimMode,
		]);

		const voiceBaseTextRef = useRef('');
		const shouldFocusAfterDictationRef = useRef(false);
		const handleNeedsDictationInstall = useCallback(() => {
			setShowDictationInstallPrompt(true);
		}, []);
		const {
			isListening,
			isTranscribing,
			isSupported: voiceSupported,
			analyser,
			error: voiceError,
			start: startVoice,
			stop: stopVoice,
		} = useVoiceInput({
			onNeedsInstall: handleNeedsDictationInstall,
			onTranscript: (transcript, isFinal) => {
				const base = voiceBaseTextRef.current;
				const sep = base && !/\s$/.test(base) ? ' ' : '';
				const nextMessage = transcript ? `${base}${sep}${transcript}` : base;

				if (isFinal && preferences.releaseToSend && nextMessage.trim()) {
					onSend(nextMessage);
					resetComposer();
					return;
				}

				setMessage(nextMessage);
				if (isFinal) {
					shouldFocusAfterDictationRef.current = true;
				}
			},
		});
		const isVoiceActive = isListening || isTranscribing;

		useEffect(() => {
			if (isVoiceActive || !shouldFocusAfterDictationRef.current) return;
			shouldFocusAfterDictationRef.current = false;
			textareaRef.current?.focus({ preventScroll: true });
		}, [isVoiceActive]);

		const handleStartVoice = useCallback(() => {
			setVoiceShortcutMode(null);
			voiceBaseTextRef.current = message;
			void startVoice();
		}, [message, startVoice]);

		const handleDictationReady = useCallback(() => {
			void startVoice();
		}, [startVoice]);

		const handleCloseShortcutsModal = useCallback(() => {
			setShowShortcutsModal(false);
		}, []);

		const handleCloseDictationInstallPrompt = useCallback(() => {
			setShowDictationInstallPrompt(false);
		}, []);

		const handleStopVoice = useCallback(() => {
			setVoiceShortcutMode(null);
			stopVoice();
			textareaRef.current?.focus();
		}, [stopVoice]);

		const handleStartVoiceRef = useRef(handleStartVoice);
		const handleStopVoiceRef = useRef(handleStopVoice);
		const voiceShortcutStateRef = useRef({
			disabled: Boolean(disabled),
			isListening,
			isTranscribing,
			voiceSupported,
		});
		const fnKeyDownRef = useRef(false);
		const fnKeyDownAtRef = useRef(0);
		const fnLatchedRecordingRef = useRef(false);
		const fnReleaseTimerRef = useRef<number | null>(null);
		const fnStopRequestedRef = useRef(false);
		const voiceShortcutKindRef = useRef<'fn' | 'web' | 'native' | null>(null);

		useEffect(() => {
			handleStartVoiceRef.current = handleStartVoice;
			handleStopVoiceRef.current = handleStopVoice;
			voiceShortcutStateRef.current = {
				disabled: Boolean(disabled),
				isListening,
				isTranscribing,
				voiceSupported,
			};

			if (!isListening) {
				fnLatchedRecordingRef.current = false;
				setVoiceShortcutMode(null);
			}

			if (
				isListening &&
				fnStopRequestedRef.current &&
				!fnKeyDownRef.current &&
				!fnLatchedRecordingRef.current
			) {
				fnStopRequestedRef.current = false;
				handleStopVoice();
			}
		}, [
			disabled,
			handleStartVoice,
			handleStopVoice,
			isListening,
			isTranscribing,
			voiceSupported,
		]);

		useEffect(() => {
			const clearReleaseTimer = () => {
				if (fnReleaseTimerRef.current === null) return;
				window.clearTimeout(fnReleaseTimerRef.current);
				fnReleaseTimerRef.current = null;
			};

			const stopFromShortcut = () => {
				clearReleaseTimer();
				fnStopRequestedRef.current = false;
				fnLatchedRecordingRef.current = false;
				setVoiceShortcutMode(null);
				handleStopVoiceRef.current();
			};

			const scheduleStop = (delayMs: number) => {
				clearReleaseTimer();
				fnReleaseTimerRef.current = window.setTimeout(() => {
					fnReleaseTimerRef.current = null;
					if (fnLatchedRecordingRef.current) return;
					setVoiceShortcutMode(null);

					if (voiceShortcutStateRef.current.isListening) {
						stopFromShortcut();
						return;
					}

					fnStopRequestedRef.current = true;
				}, delayMs);
			};

			const startShortcutPress = (kind: 'fn' | 'web' | 'native') => {
				if (fnKeyDownRef.current) return;
				const state = voiceShortcutStateRef.current;
				if (state.disabled || !state.voiceSupported || state.isTranscribing) {
					return;
				}

				voiceShortcutKindRef.current = kind;
				fnKeyDownRef.current = true;
				fnKeyDownAtRef.current = performance.now();
				setVoiceShortcutMode('hold');

				if (fnLatchedRecordingRef.current) {
					stopFromShortcut();
					return;
				}

				if (fnReleaseTimerRef.current !== null) {
					clearReleaseTimer();
					fnStopRequestedRef.current = false;
					fnLatchedRecordingRef.current = true;
					setVoiceShortcutMode('latched');
					return;
				}

				if (!state.isListening) {
					handleStartVoiceRef.current();
				}
			};

			const endShortcutPress = () => {
				const wasPressed = fnKeyDownRef.current;
				fnKeyDownRef.current = false;
				voiceShortcutKindRef.current = null;
				if (!wasPressed) return;
				if (fnLatchedRecordingRef.current) return;

				const elapsedMs = performance.now() - fnKeyDownAtRef.current;
				const delayMs = Math.max(
					0,
					VOICE_SHORTCUT_DOUBLE_PRESS_WINDOW_MS - elapsedMs,
				);
				if (delayMs > 0) {
					scheduleStop(delayMs);
					return;
				}

				if (voiceShortcutStateRef.current.isListening) {
					stopFromShortcut();
					return;
				}

				fnStopRequestedRef.current = true;
			};

			const handleKeyDown = (event: KeyboardEvent) => {
				const isGlobeShortcut = isGlobeKeyEvent(event);
				const isWebShortcut = isWebVoiceShortcutDown(event);
				if (!isGlobeShortcut && !isWebShortcut) return;

				event.preventDefault();
				event.stopPropagation();

				if (event.repeat) return;
				startShortcutPress(isGlobeShortcut ? 'fn' : 'web');
			};

			const handleKeyUp = (event: KeyboardEvent) => {
				const shortcutKind = voiceShortcutKindRef.current;
				const isCurrentShortcut =
					(shortcutKind === 'fn' && isGlobeKeyEvent(event)) ||
					(shortcutKind === 'web' && isWebVoiceShortcutUp(event));
				if (!isCurrentShortcut) return;

				event.preventDefault();
				event.stopPropagation();
				endShortcutPress();
			};

			const handleNativeShortcutDown = () => startShortcutPress('native');
			const handleNativeShortcutUp = () => endShortcutPress();

			window.addEventListener('keydown', handleKeyDown, true);
			window.addEventListener('keyup', handleKeyUp, true);
			window.addEventListener(
				'otto:voice-shortcut-down',
				handleNativeShortcutDown,
			);
			window.addEventListener('otto:voice-shortcut-up', handleNativeShortcutUp);

			return () => {
				clearReleaseTimer();
				window.removeEventListener('keydown', handleKeyDown, true);
				window.removeEventListener('keyup', handleKeyUp, true);
				window.removeEventListener(
					'otto:voice-shortcut-down',
					handleNativeShortcutDown,
				);
				window.removeEventListener(
					'otto:voice-shortcut-up',
					handleNativeShortcutUp,
				);
			};
		}, []);

		// Stop recording if the input unmounts (e.g. session switch).
		useEffect(() => {
			return () => {
				stopVoice();
			};
		}, [stopVoice]);

		useEffect(() => {
			textareaRef.current?.focus();
		}, []);

		useEffect(() => {
			if (externalIsPlanMode !== undefined) {
				setIsPlanMode(externalIsPlanMode);
			}
		}, [externalIsPlanMode]);

		useImperativeHandle(ref, () => ({
			focus: () => {
				textareaRef.current?.focus();
			},
			setValue: (value: string) => {
				setMessage(value);
				textareaRef.current?.focus();
			},
		}));

		const adjustTextareaHeight = useCallback(() => {
			const textarea = textareaRef.current;
			if (!textarea) return;
			textarea.style.height = 'auto';
			textarea.style.height = `${textarea.scrollHeight}px`;
		}, []);

		// biome-ignore lint/correctness/useExhaustiveDependencies: message and isVoiceActive intentionally trigger resizing when content changes or the textarea remounts after voice input
		useEffect(() => {
			adjustTextareaHeight();
		}, [adjustTextareaHeight, message, isVoiceActive]);

		const handleMentionClose = useCallback(() => {
			setShowFileMention(false);
			setCurrentFileToSelect(undefined);
		}, [setShowFileMention, setCurrentFileToSelect]);

		const handleSkillMentionClose = useCallback(() => {
			setShowSkillMention(false);
			setCurrentSkillToSelect(undefined);
		}, [setShowSkillMention, setCurrentSkillToSelect]);

		const handleCommandClose = useCallback(() => {
			setShowCommandSuggestions(false);
			setCurrentCommandToSelect(undefined);
		}, [setShowCommandSuggestions, setCurrentCommandToSelect]);

		const handleMentionSelect = useCallback(
			(filePath: string) => {
				selectFile(filePath, textareaRef, setMessage);
			},
			[selectFile],
		);

		const handleSkillMentionSelect = useCallback(
			(skillName: string) => {
				selectSkill(skillName, textareaRef, setMessage);
			},
			[selectSkill],
		);

		const handleSend = useCallback(() => {
			const trimmedMessage = message.trim();
			if (!trimmedMessage || disabled) return;

			const exactCommand = findExactCommand(trimmedMessage);
			if (exactCommand) {
				if (shouldSendSlashCommandAsMessage(exactCommand.id)) {
					onSend(exactCommand.label);
					resetComposer();
					return;
				}
				if (onCommand) {
					onCommand(exactCommand.id);
					resetComposer();
					return;
				}
			}

			onSend(message);
			resetComposer();
		}, [message, disabled, onCommand, onSend, resetComposer]);

		useEffect(() => {
			handleSendRef.current = handleSend;
		}, [handleSend]);

		const handleChange = useCallback(
			(e: ChangeEvent<HTMLTextAreaElement>) => {
				if (preferences.vimMode && vimMode === 'normal') {
					return;
				}

				const value = e.target.value;
				setMessage(value);

				checkForCommand(value);

				if (value.startsWith('/') && !value.includes(' ')) {
					setShowFileMention(false);
					setShowSkillMention(false);
					setCurrentFileToSelect(undefined);
					setCurrentSkillToSelect(undefined);
				} else {
					setShowCommandSuggestions(false);
					setCurrentCommandToSelect(undefined);
					checkForMention(value, e.target.selectionStart);
					checkForSkillMention(value, e.target.selectionStart);
				}
			},
			[
				preferences.vimMode,
				vimMode,
				checkForCommand,
				setShowFileMention,
				setShowSkillMention,
				setCurrentFileToSelect,
				setCurrentSkillToSelect,
				setShowCommandSuggestions,
				setCurrentCommandToSelect,
				checkForMention,
				checkForSkillMention,
			],
		);

		const handleKeyDown = useMemo(
			() =>
				createChatInputKeyHandler({
					showFileMention,
					showSkillMention,
					showCommandSuggestions,
					mentionSelectedIndex,
					skillMentionSelectedIndex,
					commandSelectedIndex,
					currentFileToSelect,
					currentSkillToSelect,
					currentCommandToSelect,
					isPlanMode,
					vimModeEnabled: preferences.vimMode,
					vimMode,
					setMentionSelectedIndex,
					setSkillMentionSelectedIndex,
					setCommandSelectedIndex,
					setShowFileMention,
					setShowSkillMention,
					setShowCommandSuggestions,
					setIsPlanMode,
					setVimMode,
					handleFileSelect: handleMentionSelect,
					handleSkillSelect: handleSkillMentionSelect,
					handleCommandSelect,
					handleSend,
					handleVimNormalMode,
					onPlanModeToggle,
				}),
			[
				showFileMention,
				showSkillMention,
				showCommandSuggestions,
				mentionSelectedIndex,
				skillMentionSelectedIndex,
				commandSelectedIndex,
				currentFileToSelect,
				currentSkillToSelect,
				currentCommandToSelect,
				isPlanMode,
				preferences.vimMode,
				vimMode,
				setMentionSelectedIndex,
				setSkillMentionSelectedIndex,
				setCommandSelectedIndex,
				setShowFileMention,
				setShowSkillMention,
				setShowCommandSuggestions,
				setVimMode,
				handleMentionSelect,
				handleSkillMentionSelect,
				handleCommandSelect,
				handleSend,
				handleVimNormalMode,
				onPlanModeToggle,
			],
		);

		useEffect(() => {
			if (!preferences.vimMode) {
				setVimMode('insert');
			}
		}, [preferences.vimMode, setVimMode]);

		const handleTextareaPaste = useCallback(
			(e: ClipboardEvent<HTMLTextAreaElement>) => {
				onPaste?.(e as unknown as ClipboardEvent);
			},
			[onPaste],
		);

		const hasImages = images.length > 0;
		const hasDocuments = documents.length > 0;
		const hasFiles = hasImages || hasDocuments;
		const inputWidthClass = preferences.fullWidthContent
			? 'w-full pointer-events-auto relative'
			: 'max-w-3xl mx-auto pointer-events-auto relative';
		const inputOverlayWidthClass = preferences.fullWidthContent
			? 'w-3/4'
			: 'w-[90%]';
		const voiceButtonMode = voiceShortcutMode ?? 'manual';
		const voiceButtonClass =
			voiceButtonMode === 'manual'
				? 'bg-red-500 hover:bg-red-500/90 active:bg-red-500/80 text-white'
				: 'bg-red-500 hover:bg-red-500/90 active:bg-red-500/80 text-white';

		return (
			<>
				{isDragging ? (
					<FileDropOverlay
						visionEnabled={visionEnabled}
						attachmentEnabled={attachmentEnabled}
					/>
				) : null}
				<div className="absolute bottom-0 left-0 right-0 px-2 pt-16 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:px-4 md:pb-6 bg-gradient-to-t from-background via-background to-transparent pointer-events-none z-20">
					<div className={inputWidthClass}>
						{preferences.vimMode && vimMode === 'normal' && (
							<div className="absolute -top-6 right-0 px-2 py-0.5 text-xs font-mono font-semibold bg-amber-500/90 text-white rounded shadow-sm">
								NORMAL
							</div>
						)}
						{preferences.vimMode && vimMode === 'insert' && (
							<div className="absolute -top-6 right-0 px-2 py-0.5 text-xs font-mono font-semibold bg-green-500/90 text-white rounded shadow-sm">
								INSERT
							</div>
						)}
						<ChatInputSessionBars
							sessionId={sessionId}
							widthClass={inputOverlayWidthClass}
						/>
						<div
							className={`relative z-10 flex flex-col rounded-3xl p-1 transition-all touch-manipulation ${
								isVoiceActive
									? 'bg-transparent border border-transparent'
									: isPlanMode
										? 'bg-slate-100 dark:bg-slate-900/40 border border-slate-300 dark:border-slate-700 focus-within:border-slate-400 dark:focus-within:border-slate-600 focus-within:ring-1 focus-within:ring-slate-300 dark:focus-within:ring-slate-700'
										: 'bg-card border border-border focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/40'
							}`}
						>
							{isVoiceActive ? (
								<VoiceInputPanel
									isListening={isListening}
									isTranscribing={isTranscribing}
									analyser={analyser}
									voiceButtonMode={voiceButtonMode}
									voiceButtonClass={voiceButtonClass}
									onStopVoice={handleStopVoice}
								/>
							) : (
								<>
									{showCommandSuggestions && (
										<CommandSuggestionsPopup
											query={commandQuery}
											selectedIndex={commandSelectedIndex}
											onSelect={handleCommandSelect}
											onEnterSelect={handleCommandEnterSelect}
											onClose={handleCommandClose}
											sessionId={sessionId}
										/>
									)}

									{showSkillMention && (
										<SkillMentionPopup
											skills={skillSummaries}
											query={skillMentionQuery}
											selectedIndex={skillMentionSelectedIndex}
											onSelect={handleSkillMentionSelect}
											onEnterSelect={handleSkillEnterSelect}
											onClose={handleSkillMentionClose}
										/>
									)}

									<AttachmentPreviewList
										images={images}
										documents={documents}
										onFileRemove={onFileRemove}
									/>

									<ResearchContextChips
										contexts={researchContexts}
										onRemove={onResearchContextRemove}
									/>

									<div className="flex items-end gap-1">
										{onConfigClick && (
											<button
												type="button"
												onClick={onConfigClick}
												className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-background/50 active:bg-background/70 transition-colors text-muted-foreground hover:text-foreground flex-shrink-0 touch-manipulation"
											>
												<MoreVertical className="w-4 h-4" />
											</button>
										)}
										<Textarea
											ref={textareaRef}
											value={message}
											onChange={handleChange}
											onKeyDown={handleKeyDown}
											onPaste={handleTextareaPaste}
											placeholder={
												isPlanMode
													? 'Plan mode - Type a message...'
													: 'Type a message...'
											}
											disabled={disabled}
											rows={1}
											className={`border-0 bg-transparent pl-1 pr-2 py-2 max-h-[200px] overflow-y-auto leading-normal resize-none scrollbar-hide text-base ${
												preferences.vimMode && vimMode === 'normal'
													? 'caret-[6px]'
													: ''
											}`}
											style={{ height: '2.5rem' }}
										/>
										{message.trim() ||
										hasFiles ||
										!voiceSupported ||
										isTranscribing ? (
											<button
												type="button"
												onClick={handleSend}
												disabled={
													disabled ||
													isTranscribing ||
													(!message.trim() && !hasFiles)
												}
												className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors flex-shrink-0 touch-manipulation ${
													message.trim() || hasFiles
														? 'bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground'
														: 'bg-transparent text-muted-foreground'
												}`}
											>
												<ArrowUp className="w-4 h-4" />
											</button>
										) : (
											<button
												type="button"
												onClick={handleStartVoice}
												disabled={disabled || isTranscribing}
												className="flex items-center justify-center w-10 h-10 rounded-full transition-colors flex-shrink-0 touch-manipulation bg-transparent text-muted-foreground hover:text-foreground hover:bg-background/50 active:bg-background/70"
												aria-label="Start voice input"
											>
												<Mic className="w-4 h-4" />
											</button>
										)}
									</div>
								</>
							)}
						</div>

						{voiceError && !isListening && (
							<div className="mt-2 px-3 text-xs text-destructive">
								{voiceError}
							</div>
						)}

						{!isVoiceActive && (
							<div
								className={`grid transition-[grid-template-rows] duration-200 ease-out ${
									reasoningEnabled ||
									visionEnabled ||
									modelName ||
									providerName ||
									authType ||
									agent
										? 'grid-rows-[1fr]'
										: 'grid-rows-[0fr]'
								}`}
							>
								<div
									className={
										showAgentDropdown ? 'overflow-visible' : 'overflow-hidden'
									}
								>
									<div className="grid grid-cols-[auto_1fr_auto] items-center mt-1 px-3">
										<div
											className="justify-self-start flex-shrink-0 relative"
											ref={agentDropdownRef}
										>
											{agent && agents.length > 0 && (
												<button
													type="button"
													onClick={() =>
														setShowAgentDropdown(!showAgentDropdown)
													}
													className="text-[10px] text-muted-foreground flex items-center gap-1 transition-colors hover:text-foreground cursor-pointer"
												>
													<span className="uppercase font-medium">{agent}</span>
													<ChevronUp
														className={`h-2.5 w-2.5 transition-transform ${showAgentDropdown ? 'rotate-180' : ''}`}
													/>
												</button>
											)}
											{showAgentDropdown && (
												<div className="absolute bottom-full left-0 mb-1 min-w-[120px] bg-popover border border-border rounded-md shadow-lg overflow-hidden z-50">
													{agents.map((a) => (
														<button
															key={a}
															type="button"
															onClick={() => {
																onAgentChange?.(a);
																setShowAgentDropdown(false);
															}}
															className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-accent ${a === agent ? 'text-foreground font-medium bg-accent/50' : 'text-muted-foreground'}`}
														>
															{a}
														</button>
													))}
												</div>
											)}
										</div>
										<div className="justify-self-center">
											{(providerName || modelName || authType) && (
												<div className="text-[10px] text-muted-foreground flex items-center gap-1 px-2 py-0.5">
													<button
														type="button"
														onClick={onModelInfoClick}
														className="flex items-center gap-1 transition-colors hover:text-foreground cursor-pointer"
													>
														{providerName && (
															<>
																<ProviderLogo
																	provider={providerName}
																	size={12}
																	className="opacity-70"
																/>
																<span className="opacity-40">/</span>
															</>
														)}
														{modelName && <span>{modelName}</span>}
														{isCustomProvider && (
															<span className="opacity-50">(custom)</span>
														)}
														{authType && authType === 'oauth' && (
															<span className="opacity-50">(pro)</span>
														)}
														{isOttoRouter && ottorouterPlanLabel && (
															<span className="opacity-50">
																({ottorouterPlanLabel.toLowerCase()})
															</span>
														)}
														{isFreeModel && (
															<span className="opacity-50">(free)</span>
														)}
													</button>
												</div>
											)}
										</div>
										<div className="justify-self-end flex-shrink-0 flex items-center gap-2">
											{reasoningEnabled && (
												<span className="text-[10px] text-indigo-600 dark:text-indigo-300 flex items-center gap-1 w-[52px] justify-center">
													<Brain className="h-3 w-3 flex-shrink-0" />
													{(
														configData?.defaults?.reasoningLevel ?? 'high'
													).replace('xhigh', 'x-high')}
												</span>
											)}
											{visionEnabled && (
												<span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
													<ImageIcon className="h-3 w-3" />
													images
												</span>
											)}
										</div>
									</div>
								</div>
							</div>
						)}

						{showFileMention && !filesLoading && (
							<FileMentionPopup
								files={files}
								changedFiles={changedFiles}
								query={mentionQuery}
								selectedIndex={mentionSelectedIndex}
								onSelect={handleMentionSelect}
								onEnterSelect={handleMentionEnterSelect}
								onClose={handleMentionClose}
							/>
						)}

						{showShortcutsModal ? (
							<ShortcutsModal isOpen onClose={handleCloseShortcutsModal} />
						) : null}

						{showDictationInstallPrompt ? (
							<DictationInstallPrompt
								isOpen
								onClose={handleCloseDictationInstallPrompt}
								onReady={handleDictationReady}
							/>
						) : null}
					</div>
				</div>
			</>
		);
	}),
);

interface FileDropOverlayProps {
	visionEnabled: boolean;
	attachmentEnabled: boolean;
}

const FileDropOverlay = memo(function FileDropOverlay({
	visionEnabled,
	attachmentEnabled,
}: FileDropOverlayProps) {
	const supportsAny = visionEnabled || attachmentEnabled;
	const fileTypes = [
		...(visionEnabled ? ['Images'] : []),
		...(attachmentEnabled ? ['PDF'] : []),
		'Markdown',
		'Text',
		'Other files',
	].join(', ');

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none">
			<div
				className={`flex flex-col items-center gap-4 p-8 rounded-2xl border-2 border-dashed ${supportsAny ? 'bg-card border-primary/50' : 'bg-card border-muted-foreground/30'}`}
			>
				<div
					className={`p-4 rounded-full ${supportsAny ? 'bg-primary/10' : 'bg-muted'}`}
				>
					<FileIcon
						className={`w-12 h-12 ${supportsAny ? 'text-primary' : 'text-muted-foreground'}`}
					/>
				</div>
				<div className="text-center">
					<p className="text-lg font-medium text-foreground">Drop files here</p>
					<p className="text-sm text-muted-foreground">
						{fileTypes} up to 100MB
					</p>
				</div>
			</div>
		</div>
	);
});

interface VoiceInputPanelProps {
	isListening: boolean;
	isTranscribing: boolean;
	analyser: AnalyserNode | null;
	voiceButtonMode: 'manual' | 'hold' | 'latched';
	voiceButtonClass: string;
	onStopVoice: () => void;
}

const VoiceInputPanel = memo(function VoiceInputPanel({
	isListening,
	isTranscribing,
	analyser,
	voiceButtonMode,
	voiceButtonClass,
	onStopVoice,
}: VoiceInputPanelProps) {
	return (
		<>
			<div className="flex items-center gap-1">
				<div className="flex-1 min-w-0 text-primary" style={{ height: '3rem' }}>
					<LiveWaveform
						active={isListening}
						analyser={analyser}
						height="3rem"
						loading={isTranscribing}
					/>
				</div>
				{isListening ? (
					<button
						type="button"
						onClick={onStopVoice}
						className={`relative flex items-center justify-center w-10 h-10 rounded-full transition-all flex-shrink-0 touch-manipulation ${voiceButtonClass}`}
						aria-label="Stop recording"
					>
						{voiceButtonMode !== 'manual' ? (
							<span className="absolute inset-1 rounded-full bg-white/15 animate-pulse" />
						) : null}
						<Square className="w-3.5 h-3.5 fill-current" />
					</button>
				) : (
					<div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-primary">
						<StableSpinner className="h-4 w-4" />
					</div>
				)}
			</div>
			{/* Invisible spacer matching the settings/meta row so the waveform stays aligned with the textarea position. */}
			<div aria-hidden className="invisible mt-1 px-3">
				<div className="px-2 py-0.5 text-[10px] leading-none">&nbsp;</div>
			</div>
		</>
	);
});

interface AttachmentPreviewListProps {
	images: FileAttachment[];
	documents: FileAttachment[];
	onFileRemove?: (id: string) => void;
}

const AttachmentPreviewList = memo(function AttachmentPreviewList({
	images,
	documents,
	onFileRemove,
}: AttachmentPreviewListProps) {
	if (images.length === 0 && documents.length === 0) return null;

	return (
		<div className="flex flex-wrap gap-2 px-3 pt-2 pb-1">
			{images.map((image) => (
				<ImageAttachmentPreview
					key={image.id}
					image={image}
					onRemove={onFileRemove}
				/>
			))}
			{documents.map((document) => (
				<DocumentAttachmentPreview
					key={document.id}
					document={document}
					onRemove={onFileRemove}
				/>
			))}
		</div>
	);
});

interface ImageAttachmentPreviewProps {
	image: FileAttachment;
	onRemove?: (id: string) => void;
}

const ImageAttachmentPreview = memo(function ImageAttachmentPreview({
	image,
	onRemove,
}: ImageAttachmentPreviewProps) {
	const handleRemove = useCallback(() => {
		onRemove?.(image.id);
	}, [image.id, onRemove]);

	return (
		<div className="relative group w-12 h-12 rounded-lg overflow-hidden bg-muted">
			{image.preview ? (
				<img
					src={image.preview}
					alt="Attachment"
					className="w-full h-full object-cover"
				/>
			) : (
				<div className="w-full h-full flex items-center justify-center">
					<ImageIcon className="w-5 h-5 text-muted-foreground" />
				</div>
			)}
			{image.uploadStatus !== 'ready' && (
				<div className="absolute inset-0 flex items-end justify-center bg-black/45 pb-0.5">
					<span className="text-[9px] font-medium text-white">
						{image.uploadStatus === 'uploading' ? 'uploading' : 'failed'}
					</span>
				</div>
			)}
			<button
				type="button"
				onClick={handleRemove}
				className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
			>
				<X className="w-3 h-3 text-white" />
			</button>
		</div>
	);
});

interface DocumentAttachmentPreviewProps {
	document: FileAttachment;
	onRemove?: (id: string) => void;
}

const DocumentAttachmentPreview = memo(function DocumentAttachmentPreview({
	document,
	onRemove,
}: DocumentAttachmentPreviewProps) {
	const handleRemove = useCallback(() => {
		onRemove?.(document.id);
	}, [document.id, onRemove]);

	return (
		<div className="relative group flex items-center gap-2 px-3 py-2 rounded-lg bg-muted max-w-[200px]">
			{document.type === 'pdf' || document.type === 'binary' ? (
				<FileIcon className="w-4 h-4 text-red-500 flex-shrink-0" />
			) : (
				<FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
			)}
			<span className="text-xs truncate">
				{document.name}
				{document.uploadStatus === 'uploading' ? ' · uploading' : ''}
				{document.uploadStatus === 'failed' ? ' · failed' : ''}
			</span>
			<button
				type="button"
				onClick={handleRemove}
				className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
			>
				<X className="w-3 h-3 text-white" />
			</button>
		</div>
	);
});

interface ResearchContextChipsProps {
	contexts: Array<{ id: string; label: string }>;
	onRemove?: (id: string) => void;
}

const ResearchContextChips = memo(function ResearchContextChips({
	contexts,
	onRemove,
}: ResearchContextChipsProps) {
	if (contexts.length === 0) return null;

	return (
		<div className="flex flex-wrap gap-2 px-3 pt-2 pb-1">
			{contexts.map((context) => (
				<ResearchContextChip
					key={context.id}
					context={context}
					onRemove={onRemove}
				/>
			))}
		</div>
	);
});

interface ResearchContextChipProps {
	context: { id: string; label: string };
	onRemove?: (id: string) => void;
}

const ResearchContextChip = memo(function ResearchContextChip({
	context,
	onRemove,
}: ResearchContextChipProps) {
	const handleRemove = useCallback(() => {
		onRemove?.(context.id);
	}, [context.id, onRemove]);

	return (
		<div className="relative group flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-500/10 border border-teal-500/30 max-w-[200px]">
			<FlaskConical className="w-4 h-4 text-teal-500 flex-shrink-0" />
			<span className="text-xs truncate text-teal-600 dark:text-teal-400">
				{context.label}
			</span>
			{onRemove && (
				<button
					type="button"
					onClick={handleRemove}
					className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
				>
					<X className="w-3 h-3 text-white" />
				</button>
			)}
		</div>
	);
});

interface ChatInputSessionBarsProps {
	sessionId?: string;
	widthClass: string;
}

const ChatInputSessionBars = memo(function ChatInputSessionBars({
	sessionId,
	widthClass,
}: ChatInputSessionBarsProps) {
	if (!sessionId) return null;

	return (
		<div className={`pointer-events-auto ${widthClass} mx-auto relative z-0`}>
			<InputQueueBar key={`${sessionId}-queue`} sessionId={sessionId} />
			<InputTodosBar key={sessionId} sessionId={sessionId} />
			<InputApprovalBar sessionId={sessionId} />
			<InputSecureInputBar sessionId={sessionId} />
		</div>
	);
});
