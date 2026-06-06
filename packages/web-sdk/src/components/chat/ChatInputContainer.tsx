import {
	memo,
	useState,
	useCallback,
	useEffect,
	useRef,
	forwardRef,
	useImperativeHandle,
	useMemo,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSendMessage } from '../../hooks/useMessages';
import {
	useSession,
	useUpdateSession,
	useDeleteSession,
} from '../../hooks/useSessions';
import { useAllModels, useConfig } from '../../hooks/useConfig';
import { useStageFiles } from '../../hooks/useGit';
import { useGitStore } from '../../stores/gitStore';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useQueueStore } from '../../stores/queueStore';
import { usePendingResearchStore } from '../../stores/pendingResearchStore';
import { useFileSelectionStore } from '../../stores/fileSelectionStore';
import { formatResearchContextForMessage } from '../../lib/parseResearchContext';
import { formatFileSelectionsForMessage } from '../../lib/fileSelectionContext';
import { toast } from '../../stores/toastStore';
import { useToastStore } from '../../stores/toastStore';
import { apiClient } from '../../lib/api-client';
import { openPlatformSession } from '../../lib/platform';
import { ChatInput } from './ChatInput';
import { ConfigModal } from './ConfigModal';

interface ChatInputContainerProps {
	sessionId: string;
	userContext?: string;
	onNewSession?: () => void;
	onDeleteSession?: () => void;
	onCopyText?: (text: string) => void | Promise<void>;
	modalPosition?: 'fixed' | 'absolute';
}

export interface ChatInputContainerRef {
	focus: () => void;
}

async function copyTextToClipboard(
	text: string,
	onCopyText?: (text: string) => void | Promise<void>,
) {
	if (onCopyText) {
		await onCopyText(text);
		return;
	}

	if (!navigator.clipboard?.writeText) {
		throw new Error('Clipboard is not available');
	}

	await navigator.clipboard.writeText(text);
}

export const ChatInputContainer = memo(
	forwardRef<ChatInputContainerRef, ChatInputContainerProps>(
		function ChatInputContainer(
			{
				sessionId,
				userContext,
				onNewSession,
				onDeleteSession,
				onCopyText,
				modalPosition,
			},
			ref,
		) {
			const session = useSession(sessionId);
			const [agent, setAgent] = useState('');
			const [provider, setProvider] = useState('');
			const [model, setModel] = useState('');
			const [inputKey, setInputKey] = useState(0);

			const chatInputRef = useRef<{
				focus: () => void;
				setValue: (value: string) => void;
			}>(null);

			const sendMessage = useSendMessage(sessionId);
			const updateSession = useUpdateSession(sessionId);
			const deleteSession = useDeleteSession();
			const { data: allModels } = useAllModels();
			const { data: config } = useConfig();
			const stageFiles = useStageFiles();
			const openCommitModalForSession = useGitStore(
				(state) => state.openCommitModalForSession,
			);
			const setActiveSessionId = useGitStore(
				(state) => state.setActiveSessionId,
			);
			const queryClient = useQueryClient();

			const selectedModel = useMemo(
				() => allModels?.[provider]?.models?.find((m) => m.id === model),
				[allModels, provider, model],
			);

			const modelSupportsReasoning = selectedModel?.reasoningText;
			const modelSupportsVision = selectedModel?.vision;
			const modelSupportsAttachment = selectedModel?.attachment;
			const modelIsFree = selectedModel?.free;

			const {
				images,
				documents,
				isDragging,
				removeFile,
				clearFiles,
				handlePaste,
			} = useFileUpload({
				supportsImages: !!modelSupportsVision,
				supportsFileAttachments: !!modelSupportsAttachment,
				sessionId,
				onError: toast.error,
			});

			const pendingContextsMap = usePendingResearchStore(
				(state) => state.pendingContexts,
			);
			const pendingFileSelectionsMap = useFileSelectionStore(
				(state) => state.pendingSelections,
			);
			const removeResearchContext = usePendingResearchStore(
				(state) => state.removeContext,
			);
			const consumeResearchContexts = usePendingResearchStore(
				(state) => state.consumeContexts,
			);
			const removeFileSelection = useFileSelectionStore(
				(state) => state.removeSelectionFromSession,
			);
			const clearFileSelections = useFileSelectionStore(
				(state) => state.clearSelections,
			);

			const pendingResearchContexts = pendingContextsMap.get(sessionId) || [];
			const pendingFileSelections =
				pendingFileSelectionsMap.get(sessionId) || [];

			const researchContexts = useMemo(
				() =>
					pendingResearchContexts.map((ctx) => ({
						id: ctx.id,
						label: ctx.label,
					})),
				[pendingResearchContexts],
			);

			const fileSelectionContexts = useMemo(
				() =>
					pendingFileSelections.map((selection) => ({
						id: selection.id,
						label: selection.label,
					})),
				[pendingFileSelections],
			);

			const handleResearchContextRemove = useCallback(
				(contextId: string) => {
					removeResearchContext(sessionId, contextId);
				},
				[sessionId, removeResearchContext],
			);

			const handleFileSelectionContextRemove = useCallback(
				(selectionId: string) => {
					removeFileSelection(sessionId, selectionId);
				},
				[sessionId, removeFileSelection],
			);

			const providerAuthType = allModels?.[provider]?.authType;
			const isCustomProvider =
				allModels?.[provider]?.label?.includes('(custom)') ?? false;

			useEffect(() => {
				if (session) {
					setAgent(session.agent);
					setProvider(session.provider);
					setModel(session.model);
				}
			}, [session]);

			useEffect(() => {
				setActiveSessionId(sessionId);
				return () => setActiveSessionId(null);
			}, [sessionId, setActiveSessionId]);

			useEffect(() => {
				setInputKey((prev) => prev + 1);
			}, []);

			const pendingRestoreText = useQueueStore(
				(state) => state.pendingRestoreText,
			);
			const consumeRestoreText = useQueueStore(
				(state) => state.consumeRestoreText,
			);

			useEffect(() => {
				if (pendingRestoreText) {
					const text = consumeRestoreText();
					if (text) {
						chatInputRef.current?.setValue(text);
					}
				}
			}, [pendingRestoreText, consumeRestoreText]);

			useImperativeHandle(ref, () => ({
				focus: () => {
					chatInputRef.current?.focus();
				},
			}));

			const handleSendMessage = useCallback(
				async (content: string) => {
					try {
						const allAttachments = [...images, ...documents];
						if (
							allAttachments.some((file) => file.uploadStatus === 'uploading')
						) {
							toast.error(
								'Still uploading attachments. Try again in a moment.',
							);
							return;
						}
						if (allAttachments.some((file) => file.uploadStatus === 'failed')) {
							toast.error('Remove failed attachments before sending.');
							return;
						}

						const researchCtxs = consumeResearchContexts(sessionId);
						const researchPrefix =
							formatResearchContextForMessage(researchCtxs);
						const fileSelectionCtxs = useFileSelectionStore
							.getState()
							.getSelections(sessionId);
						const fileSelectionPrefix =
							formatFileSelectionsForMessage(fileSelectionCtxs);
						const finalContent = [fileSelectionPrefix, researchPrefix, content]
							.filter(Boolean)
							.join('\n\n');

						const fileData =
							allAttachments.length > 0
								? allAttachments.map((f) => ({
										type: f.type,
										name: f.name,
										data: f.data,
										mediaType: f.mediaType,
										textContent: f.textContent,
										attachmentId: f.uploadedAttachment?.id,
										original: f.uploadedAttachment
											? {
													filename: f.uploadedAttachment.filename,
													size: f.uploadedAttachment.size,
													sha256: f.uploadedAttachment.sha256,
													mimeType: f.uploadedAttachment.mimeType,
												}
											: undefined,
									}))
								: undefined;

						await sendMessage.mutateAsync({
							content: finalContent,
							files: fileData,
							agent: agent || undefined,
							provider: provider || undefined,
							model: model || undefined,
							userContext: userContext || undefined,
							reasoningText:
								modelSupportsReasoning &&
								(config?.defaults?.reasoningText ?? true),
							reasoningLevel: config?.defaults?.reasoningLevel ?? 'high',
						});

						clearFiles();
						clearFileSelections(sessionId);
					} catch (error) {
						console.error('Failed to send message:', error);
					}
				},
				[
					sendMessage,
					documents,
					images,
					clearFiles,
					agent,
					provider,
					model,
					userContext,
					sessionId,
					consumeResearchContexts,
					clearFileSelections,
					config?.defaults?.reasoningLevel,
					config?.defaults?.reasoningText,
					modelSupportsReasoning,
				],
			);

			const handleCommand = useCallback(
				async (commandId: string) => {
					if (commandId === 'models') {
						openConfigRef.current?.('model');
					} else if (commandId === 'agents') {
						openConfigRef.current?.('agent');
					} else if (commandId === 'new') {
						onNewSession?.();
					} else if (commandId === 'stage') {
						try {
							await stageFiles.mutateAsync(['.']);
							toast.success('Staged all changes');
						} catch (error) {
							toast.error(
								error instanceof Error
									? error.message
									: 'Failed to stage changes',
							);
						}
					} else if (commandId === 'commit') {
						openCommitModalForSession(sessionId);
					} else if (commandId === 'compact') {
						handleSendMessage('/compact');
					} else if (commandId === 'init') {
						handleSendMessage('/init');
					} else if (commandId === 'handoff') {
						const toastId = toast.loading('Creating handoff...');
						try {
							const result = await apiClient.createHandoff(sessionId);
							queryClient.invalidateQueries({ queryKey: ['sessions'] });
							queryClient.invalidateQueries({
								queryKey: ['messages', sessionId],
							});
							queryClient.invalidateQueries({
								queryKey: ['messages', result.sessionId],
							});
							openPlatformSession(result.sessionId);
							toast.success('Handoff created');
						} catch (error) {
							toast.error(
								error instanceof Error
									? error.message
									: 'Failed to create handoff',
							);
						} finally {
							useToastStore.getState().removeToast(toastId);
						}
					} else if (commandId === 'delete') {
						deleteSession.mutate(sessionId, {
							onSuccess: () => {
								onDeleteSession?.();
							},
						});
					} else if (commandId === 'share') {
						const toastId = toast.loading('Sharing session...');
						try {
							const result = await apiClient.shareSession(sessionId);
							if (result.shared) {
								let copied = false;
								try {
									await copyTextToClipboard(result.url, onCopyText);
									copied = true;
								} catch (copyError) {
									console.warn('Failed to copy share URL:', copyError);
								}

								toast.successWithAction(
									result.message === 'Already shared'
										? copied
											? 'Already shared — link copied'
											: 'Already shared'
										: copied
											? 'Session shared — link copied!'
											: 'Session shared!',
									{ label: 'Open', href: result.url },
								);
								if (!copied) {
									toast.error('Shared, but failed to copy link');
								}
								queryClient.invalidateQueries({
									queryKey: ['share-status', sessionId],
								});
							}
						} catch (error) {
							toast.error(
								error instanceof Error ? error.message : 'Failed to share',
							);
						} finally {
							useToastStore.getState().removeToast(toastId);
						}
					} else if (commandId === 'sync') {
						const toastId = toast.loading('Syncing session...');
						try {
							const result = await apiClient.syncSession(sessionId);
							if (result.synced) {
								let copied = false;
								try {
									await copyTextToClipboard(result.url, onCopyText);
									copied = true;
								} catch (copyError) {
									console.warn('Failed to copy sync URL:', copyError);
								}

								const msg =
									result.newMessages > 0
										? `Synced ${result.newMessages} new messages${copied ? ' — link copied' : ''}`
										: copied
											? 'Already synced — link copied'
											: 'Already synced';
								toast.successWithAction(msg, {
									label: 'Open',
									href: result.url,
								});
								if (!copied) {
									toast.error('Synced, but failed to copy link');
								}
								queryClient.invalidateQueries({
									queryKey: ['share-status', sessionId],
								});
							}
						} catch (error) {
							toast.error(
								error instanceof Error ? error.message : 'Failed to sync',
							);
						} finally {
							useToastStore.getState().removeToast(toastId);
						}
					}
				},
				[
					onNewSession,
					stageFiles,
					openCommitModalForSession,
					handleSendMessage,
					deleteSession,
					sessionId,
					onDeleteSession,
					onCopyText,
					queryClient,
				],
			);

			const handleAgentChange = useCallback(
				async (value: string) => {
					setAgent(value);
					try {
						await updateSession.mutateAsync({ agent: value });
					} catch (error) {
						console.error('Failed to update agent:', error);
					}
				},
				[updateSession],
			);

			const handleModelSelectorChange = useCallback(
				async (newProvider: string, newModel: string) => {
					setProvider(newProvider);
					setModel(newModel);
					try {
						await updateSession.mutateAsync({
							provider: newProvider,
							model: newModel,
						});
					} catch (error) {
						console.error('Failed to update model:', error);
					}
				},
				[updateSession],
			);

			const handleProviderChange = useCallback(
				async (newProvider: string) => {
					setProvider(newProvider);
					if (model) {
						try {
							await updateSession.mutateAsync({
								provider: newProvider,
								model,
							});
						} catch (error) {
							console.error('Failed to update provider:', error);
						}
					}
				},
				[model, updateSession],
			);

			const handleModelChange = useCallback(
				async (newModel: string) => {
					setModel(newModel);
					try {
						await updateSession.mutateAsync({ provider, model: newModel });
					} catch (error) {
						console.error('Failed to update model:', error);
					}
				},
				[provider, updateSession],
			);

			const handlePlanModeToggle = useCallback(
				async (isPlanMode: boolean) => {
					const newAgent = isPlanMode ? 'plan' : 'build';
					setAgent(newAgent);
					try {
						await updateSession.mutateAsync({ agent: newAgent });
					} catch (error) {
						console.error('Failed to switch agent:', error);
					}
				},
				[updateSession],
			);

			const openConfigRef = useRef<
				((target: 'agent' | 'model' | null) => void) | null
			>(null);
			const handleOpenConfigReady = useCallback(
				(openConfig: (target: 'agent' | 'model' | null) => void) => {
					openConfigRef.current = openConfig;
				},
				[],
			);

			return (
				<ChatConfigModalHost
					chatInputRef={chatInputRef}
					agent={agent}
					provider={provider}
					model={model}
					modelSupportsReasoning={modelSupportsReasoning}
					onAgentChange={handleAgentChange}
					onProviderChange={handleProviderChange}
					onModelChange={handleModelChange}
					onModelSelectorChange={handleModelSelectorChange}
					modalPosition={modalPosition}
					onOpenConfigReady={handleOpenConfigReady}
				>
					{({ toggleConfig, openModelConfig }) => (
						<ChatInput
							ref={chatInputRef}
							key={inputKey}
							onSend={handleSendMessage}
							onCommand={handleCommand}
							disabled={sendMessage.isPending}
							onConfigClick={toggleConfig}
							onPlanModeToggle={handlePlanModeToggle}
							isPlanMode={agent === 'plan'}
							reasoningEnabled={
								modelSupportsReasoning &&
								(config?.defaults?.reasoningText ?? true)
							}
							sessionId={sessionId}
							images={images}
							documents={documents}
							onFileRemove={removeFile}
							isDragging={isDragging}
							onPaste={handlePaste}
							visionEnabled={modelSupportsVision}
							attachmentEnabled={modelSupportsAttachment}
							modelName={model}
							providerName={provider}
							isCustomProvider={isCustomProvider}
							authType={providerAuthType}
							isFreeModel={modelIsFree}
							researchContexts={researchContexts}
							onResearchContextRemove={handleResearchContextRemove}
							fileSelectionContexts={fileSelectionContexts}
							onFileSelectionContextRemove={handleFileSelectionContextRemove}
							onModelInfoClick={openModelConfig}
							agent={agent}
							agents={config?.agents}
							onAgentChange={handleAgentChange}
						/>
					)}
				</ChatConfigModalHost>
			);
		},
	),
);

type ConfigFocusTarget = 'agent' | 'model' | null;

type ConfigControls = {
	openConfig: (target: ConfigFocusTarget) => void;
	openModelConfig: () => void;
	toggleConfig: () => void;
};

interface ChatConfigModalHostProps {
	chatInputRef: RefObject<{
		focus: () => void;
		setValue: (value: string) => void;
	}>;
	agent: string;
	provider: string;
	model: string;
	modelSupportsReasoning?: boolean;
	onAgentChange: (agent: string) => void;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModelSelectorChange?: (provider: string, model: string) => void;
	modalPosition?: 'fixed' | 'absolute';
	onOpenConfigReady: (openConfig: (target: ConfigFocusTarget) => void) => void;
	children: (controls: ConfigControls) => ReactNode;
}

const ChatConfigModalHost = memo(function ChatConfigModalHost({
	chatInputRef,
	agent,
	provider,
	model,
	modelSupportsReasoning,
	onAgentChange,
	onProviderChange,
	onModelChange,
	onModelSelectorChange,
	modalPosition,
	onOpenConfigReady,
	children,
}: ChatConfigModalHostProps) {
	const [isConfigOpen, setIsConfigOpen] = useState(false);
	const [configFocusTarget, setConfigFocusTarget] =
		useState<ConfigFocusTarget>(null);

	const openConfig = useCallback((target: ConfigFocusTarget) => {
		setConfigFocusTarget(target);
		setIsConfigOpen(true);
	}, []);

	useEffect(() => {
		onOpenConfigReady(openConfig);
	}, [onOpenConfigReady, openConfig]);

	const toggleConfig = useCallback(() => {
		setIsConfigOpen((prev) => !prev);
	}, []);

	const handleCloseConfig = useCallback(() => {
		setIsConfigOpen(false);
		setConfigFocusTarget(null);
	}, []);

	const openModelConfig = useCallback(() => {
		openConfig('model');
	}, [openConfig]);

	const controls = useMemo(
		() => ({ openConfig, openModelConfig, toggleConfig }),
		[openConfig, openModelConfig, toggleConfig],
	);

	return (
		<>
			{isConfigOpen ? (
				<ConfigModal
					isOpen
					onClose={handleCloseConfig}
					initialFocus={configFocusTarget}
					chatInputRef={chatInputRef}
					agent={agent}
					provider={provider}
					model={model}
					modelSupportsReasoning={modelSupportsReasoning}
					onAgentChange={onAgentChange}
					onProviderChange={onProviderChange}
					onModelChange={onModelChange}
					onModelSelectorChange={onModelSelectorChange}
					modalPosition={modalPosition}
				/>
			) : null}
			{children(controls)}
		</>
	);
});
