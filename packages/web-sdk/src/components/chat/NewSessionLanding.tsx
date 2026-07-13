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
import { toast } from '../../stores/toastStore';
import { ChatInput } from './ChatInput';
import { ConfigModal } from './ConfigModal';
import { OttoMark } from '../common/OttoOIcon';
import { apiClient } from '../../lib/api-client';
import { formatFileSelectionsForMessage } from '../../lib/fileSelectionContext';
import { getSessionsQueryKey } from '../../hooks/useSessions';
import type { Session } from '../../types/api';

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
			const [transitioning, setTransitioning] = useState(false);
			const pendingSessionIdRef = useRef<string | null>(null);
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
			const chatInputRef = useRef<{
				focus: () => void;
				setValue: (value: string) => void;
			}>(null);

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
						pendingSessionIdRef.current = session.id;
						setTransitioning(true);
						setTimeout(() => {
							if (pendingSessionIdRef.current) {
								onSessionCreated(pendingSessionIdRef.current);
							}
						}, 250);
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
					<OttoMark
						size={compact ? 24 : 32}
						className="text-muted-foreground/30"
						label="otto"
					/>
				),
				[compact],
			);

			return (
				<div
					className={`flex-1 flex flex-col items-center justify-center px-4 transition-opacity duration-250 ease-out ${
						transitioning ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'
					}`}
					style={{ transitionProperty: 'opacity, transform' }}
				>
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
						<div className="flex justify-center mb-6">
							{wordmark || defaultWordmark}
						</div>
						<div className="relative min-h-[110px]">
							<ChatInput
								ref={chatInputRef}
								onSend={handleSend}
								onCommand={handleCommand}
								disabled={sending}
								sessionId={undefined}
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
							/>
						</div>
					</div>
				</div>
			);
		},
	),
);
