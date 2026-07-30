import {
	memo,
	useState,
	useCallback,
	useRef,
	forwardRef,
	useImperativeHandle,
	useEffect,
	useMemo,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useChatComposer } from '../../hooks/useChatComposer';
import { useConfigModalControls } from '../../hooks/useConfigModalControls';
import { useFileUpload } from '../../hooks/useFileUpload';
import {
	NEW_SESSION_FILE_SELECTIONS_KEY,
	useFileSelectionStore,
} from '../../stores/fileSelectionStore';
import { getNewSessionChatDraftKey } from '../../stores/chatDraftStore';
import { toast } from '../../stores/toastStore';
import { ChatInput, type ChatInputRef } from './ChatInput';
import { ConfigModal } from './ConfigModal';
import { OttoTextWordmark } from '../common/OttoOIcon';
import { apiClient } from '../../lib/api-client';
import { formatFileSelectionsForMessage } from '../../lib/fileSelectionContext';
import { getSessionsQueryKey } from '../../hooks/useSessions';
import { getMessagesQueryKey } from '../../hooks/useMessages';
import {
	captureComposerRect,
	useSessionTransitionStore,
} from '../../stores/sessionTransitionStore';
import type { Message, Session } from '../../types/api';

interface NewSessionLandingProps {
	onSessionCreated: (sessionId: string) => void;
	defaultAgent?: string;
	wordmark?: React.ReactNode;
	compact?: boolean;
	modalPosition?: 'fixed' | 'absolute';
	/** Session type for the created session (e.g. 'looper' for the Looper tab). */
	sessionType?: 'main' | 'looper';
	/** Fixes the agent (no picker); provider/model stay user-editable. */
	lockAgent?: boolean;
}

export interface NewSessionLandingRef {
	focus: () => void;
}

export const NewSessionLanding = memo(
	forwardRef<NewSessionLandingRef, NewSessionLandingProps>(
		function NewSessionLanding(
			{
				onSessionCreated,
				defaultAgent,
				wordmark,
				compact,
				modalPosition,
				sessionType,
				lockAgent = false,
			},
			ref,
		) {
			const queryClient = useQueryClient();
			const [sending, setSending] = useState(false);
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
			} = useChatComposer({ defaultAgent });
			const {
				isConfigOpen,
				configFocusTarget,
				openConfig,
				toggleConfig,
				closeConfig,
				openModelConfig,
			} = useConfigModalControls();
			const chatInputRef = useRef<ChatInputRef>(null);

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
			const pendingFileSelectionsMap = useFileSelectionStore(
				(state) => state.pendingSelections,
			);
			const removeFileSelection = useFileSelectionStore(
				(state) => state.removeSelectionFromSession,
			);
			const clearFileSelections = useFileSelectionStore(
				(state) => state.clearSelections,
			);
			const pendingFileSelections =
				pendingFileSelectionsMap.get(NEW_SESSION_FILE_SELECTIONS_KEY) ?? [];
			const fileSelectionContexts = useMemo(
				() =>
					pendingFileSelections.map((selection) => ({
						id: selection.id,
						label: selection.label,
					})),
				[pendingFileSelections],
			);
			const handleFileSelectionContextRemove = useCallback(
				(selectionId: string) => {
					removeFileSelection(NEW_SESSION_FILE_SELECTIONS_KEY, selectionId);
				},
				[removeFileSelection],
			);

			useImperativeHandle(ref, () => ({
				focus: () => {
					chatInputRef.current?.focus();
				},
			}));

			useEffect(() => {
				const timer = setTimeout(() => {
					chatInputRef.current?.focus();
				}, 100);
				return () => clearTimeout(timer);
			}, []);

			const handleCommand = useCallback(
				(commandId: string) => {
					if (commandId === 'models') {
						openConfig('model');
					} else if (commandId === 'agents' && !lockAgent) {
						openConfig('agent');
					}
				},
				[openConfig, lockAgent],
			);

			const handleSend = useCallback(
				async (content: string) => {
					if (sending || !content.trim()) return;
					const allAttachments = [...images, ...documents];
					if (
						allAttachments.some((file) => file.uploadStatus === 'uploading')
					) {
						toast.error('Still uploading attachments. Try again in a moment.');
						return;
					}
					if (allAttachments.some((file) => file.uploadStatus === 'failed')) {
						toast.error('Remove failed attachments before sending.');
						return;
					}
					setSending(true);
					const composerRect = captureComposerRect(
						chatInputRef.current?.getBoundaryElement(),
					);

					try {
						const session: Session = await apiClient.createSession({
							agent: agent || 'general',
							provider: provider || undefined,
							model: model || undefined,
							sessionType: sessionType === 'looper' ? 'looper' : undefined,
						});

						queryClient.invalidateQueries({ queryKey: getSessionsQueryKey() });

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

						const fileSelectionCtxs = useFileSelectionStore
							.getState()
							.getSelections(NEW_SESSION_FILE_SELECTIONS_KEY);
						const fileSelectionPrefix =
							formatFileSelectionsForMessage(fileSelectionCtxs);
						const finalContent = [fileSelectionPrefix, content]
							.filter(Boolean)
							.join('\n\n');

						await apiClient.sendMessage(session.id, {
							content: finalContent,
							files: fileData,
							agent: agent || undefined,
							provider: provider || undefined,
							model: model || undefined,
							reasoningText:
								modelSupportsReasoning &&
								(config?.defaults?.reasoningText ?? true),
							reasoningLevel: config?.defaults?.reasoningLevel ?? 'high',
						});

						clearFiles();
						clearFileSelections(NEW_SESSION_FILE_SELECTIONS_KEY);

						// Warm the thread before navigating so the new route paints the
						// sent message immediately instead of flashing a loading state,
						// which would break the composer handoff animation.
						await queryClient
							.fetchQuery<Message[]>({
								queryKey: getMessagesQueryKey(session.id),
								queryFn: () => apiClient.getMessages(session.id),
							})
							.catch(() => undefined);

						if (composerRect) {
							useSessionTransitionStore
								.getState()
								.startHandoff(session.id, composerRect);
						}
						onSessionCreated(session.id);
					} catch (error) {
						toast.error(
							error instanceof Error
								? error.message
								: 'Failed to create session',
						);
						setSending(false);
					}
				},
				[
					sending,
					config,
					agent,
					provider,
					model,
					sessionType,
					images,
					documents,
					clearFiles,
					clearFileSelections,
					onSessionCreated,
					queryClient,
					modelSupportsReasoning,
				],
			);

			const defaultWordmark = useMemo(
				() => (
					<OttoTextWordmark
						height={compact ? 24 : 36}
						className="text-muted-foreground/30"
					/>
				),
				[compact],
			);

			return (
				<div className="flex-1 flex flex-col items-center justify-center px-4">
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
							hideAgentSelector={lockAgent}
						/>
					) : null}
					<div className={`w-full ${compact ? 'max-w-xl' : 'max-w-2xl'}`}>
						<div
							className={`flex justify-center mb-6 transition-all duration-200 ease-out ${
								sending ? 'opacity-0 -translate-y-2' : 'opacity-100'
							}`}
						>
							{wordmark || defaultWordmark}
						</div>
						<div className="relative">
							<ChatInput
								ref={chatInputRef}
								onSend={handleSend}
								onCommand={handleCommand}
								disabled={sending}
								sessionId={undefined}
								draftKey={getNewSessionChatDraftKey(sessionType)}
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
								fileSelectionContexts={fileSelectionContexts}
								onFileSelectionContextRemove={handleFileSelectionContextRemove}
								onConfigClick={toggleConfig}
								onModelInfoClick={openModelConfig}
								reasoningEnabled={
									modelSupportsReasoning &&
									(config?.defaults?.reasoningText ?? true)
								}
								agent={agent}
								agents={lockAgent ? [] : agentNames}
								onAgentChange={handleAgentChange}
								agentLocked={lockAgent}
								onPlanModeToggle={handlePlanModeToggle}
								isPlanMode={isPlanMode}
								inlineLayout
							/>
						</div>
					</div>
				</div>
			);
		},
	),
);
