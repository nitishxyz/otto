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
import { getMessagesQueryKey, useSendMessage } from '../../hooks/useMessages';
import { getSessionsQueryKey, useDeleteSession } from '../../hooks/useSessions';
import { useChatComposer } from '../../hooks/useChatComposer';
import { useConfigModalControls } from '../../hooks/useConfigModalControls';
import { useStageFiles } from '../../hooks/useGit';
import { useGitStore } from '../../stores/gitStore';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useQueueStore } from '../../stores/queueStore';
import { usePendingResearchStore } from '../../stores/pendingResearchStore';
import { useFileSelectionStore } from '../../stores/fileSelectionStore';
import { getSessionChatDraftKey } from '../../stores/chatDraftStore';
import { formatResearchContextForMessage } from '../../lib/parseResearchContext';
import { formatFileSelectionsForMessage } from '../../lib/fileSelectionContext';
import { toChatDraftAttachment } from '../../lib/chatAttachments';
import { toast } from '../../stores/toastStore';
import { useToastStore } from '../../stores/toastStore';
import { apiClient } from '../../lib/api-client';
import { openPlatformSession } from '../../lib/platform';
import { ChatInput, type ChatInputRef } from './ChatInput';
import { ConfigModal } from './ConfigModal';

interface ChatInputContainerProps {
	sessionId: string;
	userContext?: string;
	onNewSession?: () => void;
	onDeleteSession?: () => void;
	onCopyText?: (text: string) => void | Promise<void>;
	modalPosition?: 'fixed' | 'absolute';
	/** Fixes the session agent (no agent picker); provider/model stay editable. */
	lockedAgent?: boolean;
	/** Extra bars rendered above the input alongside InputTodosBar. */
	topBars?: React.ReactNode;
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
				lockedAgent = false,
				topBars,
			},
			ref,
		) {
			const [inputKey, setInputKey] = useState(0);

			const chatInputRef = useRef<ChatInputRef>(null);

			const sendMessage = useSendMessage(sessionId);
			const deleteSession = useDeleteSession();
			const {
				config,
				agent,
				provider,
				model,
				agentNames,
				isPlanMode,
				modelSupportsReasoning,
				modelSupportsVision,
				modelSupportsAttachment,
				modelIsFree,
				providerAuthType,
				isCustomProvider,
				handleAgentChange,
				handlePlanModeToggle,
				handleProviderChange,
				handleModelChange,
				handleModelSelectorChange,
			} = useChatComposer({ sessionId });
			const {
				isConfigOpen,
				configFocusTarget,
				openConfig,
				toggleConfig,
				closeConfig,
				openModelConfig,
			} = useConfigModalControls();
			const stageFiles = useStageFiles();
			const openCommitModalForSession = useGitStore(
				(state) => state.openCommitModalForSession,
			);
			const setActiveSessionId = useGitStore(
				(state) => state.setActiveSessionId,
			);
			const queryClient = useQueryClient();
			const draftKey = getSessionChatDraftKey(sessionId);

			const {
				images,
				documents,
				isDragging,
				removeFile,
				clearFiles,
				restoreFiles,
				handlePaste,
			} = useFileUpload({
				supportsImages: !!modelSupportsVision,
				supportsFileAttachments: !!modelSupportsAttachment,
				sessionId,
				draftKey,
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

			useEffect(() => {
				setActiveSessionId(sessionId);
				return () => setActiveSessionId(null);
			}, [sessionId, setActiveSessionId]);

			useEffect(() => {
				setInputKey((prev) => prev + 1);
			}, []);

			const pendingRestore = useQueueStore((state) => state.pendingRestore);
			const consumeRestore = useQueueStore((state) => state.consumeRestore);

			useEffect(() => {
				if (!pendingRestore || pendingRestore.sessionId !== sessionId) return;
				const restore = consumeRestore(sessionId);
				if (!restore) return;
				chatInputRef.current?.setValue(restore.text);
				restoreFiles(restore.attachments);
			}, [pendingRestore, consumeRestore, restoreFiles, sessionId]);

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

						const result = await sendMessage.mutateAsync({
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

						if (result.pluginCommand) {
							toast.success(
								`Started ${result.pluginCommand.title} in terminal`,
							);
						}

						clearFiles();
						clearFileSelections(sessionId);
					} catch (error) {
						console.error('Failed to send message:', error);
						// Put the typed message (and any uploaded attachments) back into
						// the input so a failed send never loses the user's text.
						useQueueStore.getState().setPendingRestore({
							sessionId,
							text: content,
							attachments: [...images, ...documents]
								.map(toChatDraftAttachment)
								.filter(
									(attachment): attachment is NonNullable<typeof attachment> =>
										Boolean(attachment),
								),
						});
						toast.error(
							error instanceof Error ? error.message : 'Failed to send message',
						);
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
						openConfig('model');
					} else if (commandId === 'agents') {
						openConfig('agent');
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
							queryClient.invalidateQueries({
								queryKey: getSessionsQueryKey(),
							});
							queryClient.invalidateQueries({
								queryKey: getMessagesQueryKey(sessionId),
							});
							queryClient.invalidateQueries({
								queryKey: getMessagesQueryKey(result.sessionId),
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
					openConfig,
				],
			);

			return (
				<>
					{isConfigOpen ? (
						<ConfigModal
							isOpen
							onClose={closeConfig}
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
							hideAgentSelector={lockedAgent}
						/>
					) : null}
					<ChatInput
						ref={chatInputRef}
						key={inputKey}
						onSend={handleSendMessage}
						onCommand={handleCommand}
						disabled={sendMessage.isPending}
						onConfigClick={toggleConfig}
						onPlanModeToggle={handlePlanModeToggle}
						isPlanMode={isPlanMode}
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
						agents={lockedAgent ? [] : agentNames}
						onAgentChange={handleAgentChange}
						agentLocked={lockedAgent}
						topBars={topBars}
					/>
				</>
			);
		},
	),
);
