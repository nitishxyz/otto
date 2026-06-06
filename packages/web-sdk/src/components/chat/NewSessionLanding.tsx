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
import { useConfig, useAllModels } from '../../hooks/useConfig';
import { useFileUpload } from '../../hooks/useFileUpload';
import {
	NEW_SESSION_FILE_SELECTIONS_KEY,
	useFileSelectionStore,
} from '../../stores/fileSelectionStore';
import { toast } from '../../stores/toastStore';
import { ChatInput } from './ChatInput';
import { ConfigModal } from './ConfigModal';
import { apiClient } from '../../lib/api-client';
import { formatFileSelectionsForMessage } from '../../lib/fileSelectionContext';
import { sessionsQueryKey } from '../../hooks/useSessions';
import type { Session } from '../../types/api';

interface NewSessionLandingProps {
	onSessionCreated: (sessionId: string) => void;
	defaultAgent?: string;
	wordmark?: React.ReactNode;
	compact?: boolean;
	modalPosition?: 'fixed' | 'absolute';
}

export interface NewSessionLandingRef {
	focus: () => void;
}

export const NewSessionLanding = memo(
	forwardRef<NewSessionLandingRef, NewSessionLandingProps>(
		function NewSessionLanding(
			{ onSessionCreated, defaultAgent, wordmark, compact, modalPosition },
			ref,
		) {
			const { data: config } = useConfig();
			const { data: allModels } = useAllModels();
			const queryClient = useQueryClient();
			const [sending, setSending] = useState(false);
			const [transitioning, setTransitioning] = useState(false);
			const pendingSessionIdRef = useRef<string | null>(null);
			const [agent, setAgent] = useState('');
			const [provider, setProvider] = useState('');
			const [model, setModel] = useState('');
			const [isConfigOpen, setIsConfigOpen] = useState(false);
			const [configFocusTarget, setConfigFocusTarget] = useState<
				'agent' | 'model' | null
			>(null);
			const chatInputRef = useRef<{
				focus: () => void;
				setValue: (value: string) => void;
			}>(null);
			const initializedRef = useRef(false);

			useEffect(() => {
				if (initializedRef.current || !config?.defaults) return;
				initializedRef.current = true;
				setAgent(defaultAgent || config.defaults.agent || 'general');
				setProvider(config.defaults.provider || '');
				setModel(config.defaults.model || '');
			}, [config, defaultAgent]);

			const modelSupportsVision = allModels?.[provider]?.models?.find(
				(m) => m.id === model,
			)?.vision;

			const modelSupportsAttachment = allModels?.[provider]?.models?.find(
				(m) => m.id === model,
			)?.attachment;

			const modelSupportsReasoning = allModels?.[provider]?.models?.find(
				(m) => m.id === model,
			)?.reasoningText;

			const modelIsFree = allModels?.[provider]?.models?.find(
				(m) => m.id === model,
			)?.free;

			const providerAuthType = allModels?.[provider]?.authType;
			const isCustomProvider =
				allModels?.[provider]?.label?.includes('(custom)') ?? false;

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

			const handleAgentChange = useCallback((value: string) => {
				setAgent(value);
			}, []);

			const handlePlanModeToggle = useCallback((isPlanMode: boolean) => {
				setAgent(isPlanMode ? 'plan' : 'build');
			}, []);

			const handleProviderChange = useCallback((value: string) => {
				setProvider(value);
			}, []);

			const handleModelChange = useCallback((value: string) => {
				setModel(value);
			}, []);

			const handleModelSelectorChange = useCallback(
				(newProvider: string, newModel: string) => {
					setProvider(newProvider);
					setModel(newModel);
				},
				[],
			);

			const handleToggleConfig = useCallback(() => {
				setIsConfigOpen((prev) => !prev);
			}, []);

			const handleCloseConfig = useCallback(() => {
				setIsConfigOpen(false);
				setConfigFocusTarget(null);
			}, []);

			const handleCommand = useCallback((commandId: string) => {
				if (commandId === 'models') {
					setConfigFocusTarget('model');
					setIsConfigOpen(true);
				} else if (commandId === 'agents') {
					setConfigFocusTarget('agent');
					setIsConfigOpen(true);
				}
			}, []);

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
						});

						queryClient.invalidateQueries({ queryKey: sessionsQueryKey });

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
					<svg
						width={compact ? 60 : 80}
						height={compact ? 24 : 32}
						viewBox="0 0 748 303"
						fill="currentColor"
						className="text-muted-foreground/30"
						aria-label="otto"
						role="img"
					>
						<path d="M192.877 257.682C192.877 263.287 191.783 268.551 189.596 273.473C187.545 278.395 184.674 282.701 180.982 286.393C177.428 289.947 173.189 292.818 168.268 295.006C163.482 297.057 158.287 298.082 152.682 298.082H44.1953C38.7266 298.082 33.5312 297.057 28.6094 295.006C23.6875 292.818 19.3809 289.947 15.6895 286.393C12.1348 282.701 9.26367 278.395 7.07617 273.473C5.02539 268.551 4 263.287 4 257.682V120.074C4 114.469 5.02539 109.205 7.07617 104.283C9.26367 99.3613 12.1348 95.123 15.6895 91.5684C19.3809 87.877 23.6875 85.0059 28.6094 82.9551C33.5312 80.7676 38.7266 79.6738 44.1953 79.6738H152.682C158.287 79.6738 163.482 80.7676 168.268 82.9551C173.189 85.0059 177.428 87.877 180.982 91.5684C184.674 95.123 187.545 99.3613 189.596 104.283C191.783 109.205 192.877 114.469 192.877 120.074V257.682ZM44.1953 120.074V257.682H152.682V120.074H44.1953ZM331.715 4V298.082H289.674V46.041H239.225V4H331.715ZM478.961 4V298.082H436.92V46.041H386.471V4H478.961ZM743.717 257.682C743.717 263.287 742.623 268.551 740.436 273.473C738.385 278.395 735.514 282.701 731.822 286.393C728.268 289.947 724.029 292.818 719.107 295.006C714.322 297.057 709.127 298.082 703.521 298.082H595.035C589.566 298.082 584.371 297.057 579.449 295.006C574.527 292.818 570.221 289.947 566.529 286.393C562.975 282.701 560.104 278.395 557.916 273.473C555.865 268.551 554.84 263.287 554.84 257.682V120.074C554.84 114.469 555.865 109.205 557.916 104.283C560.104 99.3613 562.975 95.123 566.529 91.5684C570.221 87.877 574.527 85.0059 579.449 82.9551C584.371 80.7676 589.566 79.6738 595.035 79.6738H703.521C709.127 79.6738 714.322 80.7676 719.107 82.9551C724.029 85.0059 728.268 87.877 731.822 91.5684C735.514 95.123 738.385 99.3613 740.436 104.283C742.623 109.205 743.717 114.469 743.717 120.074V257.682ZM595.035 120.074V257.682H703.521V120.074H595.035Z" />
					</svg>
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
								onConfigClick={handleToggleConfig}
								onModelInfoClick={() => {
									setConfigFocusTarget('model');
									setIsConfigOpen(true);
								}}
								reasoningEnabled={
									modelSupportsReasoning &&
									(config?.defaults?.reasoningText ?? true)
								}
								agent={agent}
								agents={config?.agents}
								onAgentChange={handleAgentChange}
								onPlanModeToggle={handlePlanModeToggle}
								isPlanMode={agent === 'plan'}
							/>
						</div>
					</div>
				</div>
			);
		},
	),
);
