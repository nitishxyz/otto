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
} from 'lucide-react';
import { Textarea } from '../ui/Textarea';
import { FileMentionPopup } from './FileMentionPopup';
import { CommandSuggestionsPopup } from './CommandSuggestionsPopup';
import { ShortcutsModal } from './ShortcutsModal';
import { ProviderLogo } from '../common/ProviderLogo';
import { useFiles } from '../../hooks/useFiles';
import { usePreferences } from '../../hooks/usePreferences';
import { useConfig, useUpdateDefaults } from '../../hooks/useConfig';
import { useVimMode } from '../../hooks/useVimMode';
import { useFileMention } from '../../hooks/useFileMention';
import { useCommandSuggestions } from '../../hooks/useCommandSuggestions';
import { createChatInputKeyHandler } from './ChatInputKeyHandler';
import {
	findExactCommand,
	shouldSendSlashCommandAsMessage,
} from '../../lib/commands';
import { useOttoRouterStore } from '../../stores/ottorouterStore';
import type { FileAttachment } from '../../hooks/useFileUpload';
import { InputApprovalBar } from './InputApprovalBar';
import { InputTodosBar } from './InputTodosBar';

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
		const [showAgentDropdown, setShowAgentDropdown] = useState(false);
		const textareaRef = useRef<HTMLTextAreaElement>(null);
		const agentDropdownRef = useRef<HTMLDivElement>(null);

		const { preferences, updatePreferences } = usePreferences();
		const { data: configData } = useConfig();
		const updateDefaultsMutation = useUpdateDefaults();

		const setuSubscription = useOttoRouterStore((s) => s.subscription);
		const isSetu = providerName === 'ottorouter';
		const setuPlanLabel = useMemo(() => {
			if (!isSetu) return null;
			if (setuSubscription?.active) {
				return setuSubscription.tierName ?? 'GO';
			}
			return null;
		}, [isSetu, setuSubscription]);

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

		// biome-ignore lint/correctness/useExhaustiveDependencies: message dependency required for adjusting textarea height on content change
		useEffect(() => {
			adjustTextareaHeight();
		}, [adjustTextareaHeight, message]);

		const handleMentionClose = useCallback(() => {
			setShowFileMention(false);
			setCurrentFileToSelect(undefined);
		}, [setShowFileMention, setCurrentFileToSelect]);

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

		const handleSend = useCallback(() => {
			const trimmedMessage = message.trim();
			if (!trimmedMessage || disabled) return;

			const resetComposer = () => {
				setMessage('');
				setShowFileMention(false);
				setShowCommandSuggestions(false);
				setCurrentFileToSelect(undefined);
				setCurrentCommandToSelect(undefined);

				if (textareaRef.current) {
					textareaRef.current.style.height = 'auto';
				}

				if (preferences.vimMode) {
					setVimMode('normal');
				}

				textareaRef.current?.focus();
			};

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
		}, [
			message,
			disabled,
			onCommand,
			onSend,
			preferences.vimMode,
			setShowFileMention,
			setShowCommandSuggestions,
			setCurrentFileToSelect,
			setCurrentCommandToSelect,
			setVimMode,
		]);

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
					setCurrentFileToSelect(undefined);
				} else {
					setShowCommandSuggestions(false);
					setCurrentCommandToSelect(undefined);
					checkForMention(value, e.target.selectionStart);
				}
			},
			[
				preferences.vimMode,
				vimMode,
				checkForCommand,
				setShowFileMention,
				setCurrentFileToSelect,
				setShowCommandSuggestions,
				setCurrentCommandToSelect,
				checkForMention,
			],
		);

		const handleKeyDown = useMemo(
			() =>
				createChatInputKeyHandler({
					showFileMention,
					showCommandSuggestions,
					mentionSelectedIndex,
					commandSelectedIndex,
					currentFileToSelect,
					currentCommandToSelect,
					isPlanMode,
					vimModeEnabled: preferences.vimMode,
					vimMode,
					setMentionSelectedIndex,
					setCommandSelectedIndex,
					setShowFileMention,
					setShowCommandSuggestions,
					setIsPlanMode,
					setVimMode,
					handleFileSelect: handleMentionSelect,
					handleCommandSelect,
					handleSend,
					handleVimNormalMode,
					onPlanModeToggle,
				}),
			[
				showFileMention,
				showCommandSuggestions,
				mentionSelectedIndex,
				commandSelectedIndex,
				currentFileToSelect,
				currentCommandToSelect,
				isPlanMode,
				preferences.vimMode,
				vimMode,
				setMentionSelectedIndex,
				setCommandSelectedIndex,
				setShowFileMention,
				setShowCommandSuggestions,
				setVimMode,
				handleMentionSelect,
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

		return (
			<>
				{isDragging &&
					(() => {
						const supportsAny = visionEnabled || attachmentEnabled;
						const fileTypes = [
							...(visionEnabled ? ['Images'] : []),
							...(attachmentEnabled ? ['PDF'] : []),
							'Markdown',
							'Text',
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
										<p className="text-lg font-medium text-foreground">
											Drop files here
										</p>
										<p className="text-sm text-muted-foreground">
											{fileTypes} up to 10MB
										</p>
									</div>
								</div>
							</div>
						);
					})()}
				<div className="absolute bottom-0 left-0 right-0 pt-16 pb-5 md:pb-6 px-2 md:px-4 bg-gradient-to-t from-background via-background to-transparent pointer-events-none z-20 safe-area-inset-bottom">
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
						{sessionId && (
							<div
								className={`pointer-events-auto ${inputOverlayWidthClass} mx-auto relative z-0`}
							>
								<InputTodosBar key={sessionId} sessionId={sessionId} />
								<InputApprovalBar sessionId={sessionId} />
							</div>
						)}
						<div
							className={`relative z-10 flex flex-col rounded-3xl p-1 transition-all touch-manipulation ${
								isPlanMode
									? 'bg-slate-100 dark:bg-slate-900/40 border border-slate-300 dark:border-slate-700 focus-within:border-slate-400 dark:focus-within:border-slate-600 focus-within:ring-1 focus-within:ring-slate-300 dark:focus-within:ring-slate-700'
									: 'bg-card border border-border focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/40'
							}`}
						>
							{hasFiles && (
								<div className="flex flex-wrap gap-2 px-3 pt-2 pb-1">
									{images.map((img) => (
										<div
											key={img.id}
											className="relative group w-12 h-12 rounded-lg overflow-hidden bg-muted"
										>
											<img
												src={img.preview}
												alt="Attachment"
												className="w-full h-full object-cover"
											/>
											<button
												type="button"
												onClick={() => onFileRemove?.(img.id)}
												className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
											>
												<X className="w-3 h-3 text-white" />
											</button>
										</div>
									))}
									{documents.map((doc) => (
										<div
											key={doc.id}
											className="relative group flex items-center gap-2 px-3 py-2 rounded-lg bg-muted max-w-[200px]"
										>
											{doc.type === 'pdf' ? (
												<FileIcon className="w-4 h-4 text-red-500 flex-shrink-0" />
											) : (
												<FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
											)}
											<span className="text-xs truncate">{doc.name}</span>
											<button
												type="button"
												onClick={() => onFileRemove?.(doc.id)}
												className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
											>
												<X className="w-3 h-3 text-white" />
											</button>
										</div>
									))}
								</div>
							)}

							{researchContexts.length > 0 && (
								<div className="flex flex-wrap gap-2 px-3 pt-2 pb-1">
									{researchContexts.map((ctx) => (
										<div
											key={ctx.id}
											className="relative group flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-500/10 border border-teal-500/30 max-w-[200px]"
										>
											<FlaskConical className="w-4 h-4 text-teal-500 flex-shrink-0" />
											<span className="text-xs truncate text-teal-600 dark:text-teal-400">
												{ctx.label}
											</span>
											{onResearchContextRemove && (
												<button
													type="button"
													onClick={() => onResearchContextRemove(ctx.id)}
													className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
												>
													<X className="w-3 h-3 text-white" />
												</button>
											)}
										</div>
									))}
								</div>
							)}

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
								<button
									type="button"
									onClick={handleSend}
									disabled={disabled || (!message.trim() && !hasFiles)}
									className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors flex-shrink-0 touch-manipulation ${
										message.trim() || hasFiles
											? 'bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground'
											: 'bg-transparent text-muted-foreground'
									}`}
								>
									<ArrowUp className="w-4 h-4" />
								</button>
							</div>
						</div>

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
												onClick={() => setShowAgentDropdown(!showAgentDropdown)}
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
													{isSetu && setuPlanLabel && (
														<span className="opacity-50">
															({setuPlanLabel.toLowerCase()})
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

						<ShortcutsModal
							isOpen={showShortcutsModal}
							onClose={() => setShowShortcutsModal(false)}
						/>
					</div>
				</div>
			</>
		);
	}),
);
