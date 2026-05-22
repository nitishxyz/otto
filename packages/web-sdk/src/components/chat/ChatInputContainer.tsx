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
import { formatResearchContextForMessage } from '../../lib/parseResearchContext';
import { toast } from '../../stores/toastStore';
import { useToastStore } from '../../stores/toastStore';
import { apiClient } from '../../lib/api-client';
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
			const [isConfigOpen, setIsConfigOpen] = useState(false);
			const [configFocusTarget, setConfigFocusTarget] = useState<
				'agent' | 'model' | null
			>(null);
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

			const modelSupportsReasoning = allModels?.[provider]?.models?.find(
				(m) => m.id === model,
			)?.reasoningText;

			const modelSupportsVision = allModels?.[provider]?.models?.find(
				(m) => m.id === model,
			)?.vision;

			const modelSupportsAttachment = allModels?.[provider]?.models?.find(
				(m) => m.id === model,
			)?.attachment;

			const modelIsFree = allModels?.[provider]?.models?.find(
				(m) => m.id === model,
			)?.free;

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
				onError: toast.error,
			});

			const pendingContextsMap = usePendingResearchStore(
				(state) => state.pendingContexts,
			);
			const removeResearchContext = usePendingResearchStore(
				(state) => state.removeContext,
			);
			const consumeResearchContexts = usePendingResearchStore(
				(state) => state.consumeContexts,
			);

			const pendingResearchContexts = pendingContextsMap.get(sessionId) || [];

			const researchContexts = useMemo(
				() =>
					pendingResearchContexts.map((ctx) => ({
						id: ctx.id,
						label: ctx.label,
					})),
				[pendingResearchContexts],
			);

			const handleResearchContextRemove = useCallback(
				(contextId: string) => {
					removeResearchContext(sessionId, contextId);
				},
				[sessionId, removeResearchContext],
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
						const researchCtxs = consumeResearchContexts(sessionId);
						const researchPrefix =
							formatResearchContextForMessage(researchCtxs);
						const finalContent = researchPrefix
							? `${researchPrefix}\n\n${content}`
							: content;

						const imageData =
							images.length > 0
								? images.map((img) => ({
										data: img.data,
										mediaType: img.mediaType,
									}))
								: undefined;

						const fileData =
							documents.length > 0
								? documents.map((f) => ({
										type: f.type,
										name: f.name,
										data: f.data,
										mediaType: f.mediaType,
										textContent: f.textContent,
									}))
								: undefined;

						await sendMessage.mutateAsync({
							content: finalContent,
							images: imageData,
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
					config?.defaults?.reasoningLevel,
					config?.defaults?.reasoningText,
					modelSupportsReasoning,
				],
			);

			const handleToggleConfig = useCallback(() => {
				setIsConfigOpen((prev) => !prev);
			}, []);

			const handleCloseConfig = useCallback(() => {
				setIsConfigOpen(false);
				setConfigFocusTarget(null);
			}, []);

			const handleCommand = useCallback(
				async (commandId: string) => {
					if (commandId === 'models') {
						setConfigFocusTarget('model');
						setIsConfigOpen(true);
					} else if (commandId === 'agents') {
						setConfigFocusTarget('agent');
						setIsConfigOpen(true);
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

			return (
				<>
					<ConfigModal
						isOpen={isConfigOpen}
						onClose={handleCloseConfig}
						initialFocus={configFocusTarget}
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
					/>
					<ChatInput
						ref={chatInputRef}
						key={inputKey}
						onSend={handleSendMessage}
						onCommand={handleCommand}
						disabled={sendMessage.isPending}
						onConfigClick={handleToggleConfig}
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
						onModelInfoClick={() => {
							setConfigFocusTarget('model');
							setIsConfigOpen(true);
						}}
						agent={agent}
						agents={config?.agents}
						onAgentChange={handleAgentChange}
					/>
				</>
			);
		},
	),
);
