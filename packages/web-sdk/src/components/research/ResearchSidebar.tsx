import { memo, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
	FlaskConical,
	Plus,
	History,
	ArrowUp,
	ArrowDownToLine,
	ExternalLink,
	ChevronDown,
	Check,
	X,
} from 'lucide-react';
import { useResearchStore } from '../../stores/researchStore';
import { usePanelWidthStore } from '../../stores/panelWidthStore';
import {
	useResearchSessions,
	useCreateResearchSession,
	useInjectContext,
	useExportToSession,
	type ResearchSession,
} from '../../hooks/useResearch';
import { useSession, useUpdateSession } from '../../hooks/useSessions';
import { useAllModels } from '../../hooks/useConfig';
import { getMessagesQueryKey, useMessages } from '../../hooks/useMessages';
import { useSessionStream } from '../../hooks/useSessionStream';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { projectScopedKey } from '../../lib/api-client/utils';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { Modal } from '../ui/Modal';
import { SidebarHeader } from '../ui/SidebarHeader';
import { StableSpinner } from '../ui/StableSpinner';
import { UnifiedModelSelector } from '../chat/UnifiedModelSelector';
import { AssistantMessageGroup } from '../messages/AssistantMessageGroup';
import { UserMessageGroup } from '../messages/UserMessageGroup';
import { ResizeHandle } from '../ui/ResizeHandle';

const PANEL_KEY = 'research';
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 320;
const MAX_WIDTH = 600;

interface ResearchSidebarProps {
	parentSessionId: string | null;
	onNavigateToSession?: (sessionId: string) => void;
}

export const ResearchSidebar = memo(function ResearchSidebar({
	parentSessionId,
	onNavigateToSession,
}: ResearchSidebarProps) {
	const isExpanded = useResearchStore((state) => state.isExpanded);
	return isExpanded ? (
		<ResearchSidebarContent
			parentSessionId={parentSessionId}
			onNavigateToSession={onNavigateToSession}
		/>
	) : null;
});

const ResearchSidebarContent = memo(function ResearchSidebarContent({
	parentSessionId,
	onNavigateToSession,
}: ResearchSidebarProps) {
	const collapseSidebar = useResearchStore((state) => state.collapseSidebar);
	const panelWidth = usePanelWidthStore(
		(s) => s.widths[PANEL_KEY] ?? DEFAULT_WIDTH,
	);
	const activeResearchSessionId = useResearchStore(
		(state) => state.activeResearchSessionId,
	);
	const selectResearchSession = useResearchStore(
		(state) => state.selectResearchSession,
	);

	const [showHistory, setShowHistory] = useState(false);
	const [inputValue, setInputValue] = useState('');
	const [showModelSelector, setShowModelSelector] = useState(false);
	const [injectionStatus, setInjectionStatus] = useState<
		'idle' | 'success' | 'error'
	>('idle');
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const {
		data: researchData,
		isLoading,
		refetch,
	} = useResearchSessions(parentSessionId, true);
	const createMutation = useCreateResearchSession();
	const injectMutation = useInjectContext();
	const exportMutation = useExportToSession();
	const { data: allModels } = useAllModels();

	const { data: messagesData } = useMessages(
		activeResearchSessionId ?? undefined,
		{ enabled: true },
	);

	const { data: parentMessagesData } = useMessages(
		parentSessionId ?? undefined,
		{ enabled: true },
	);

	// Enable streaming for the active research session
	useSessionStream(activeResearchSessionId ?? undefined, true);

	const updateSession = useUpdateSession(activeResearchSessionId ?? '');

	const queryClient = useQueryClient();
	const sendMessage = useMutation({
		mutationFn: async ({
			sessionId,
			content,
		}: {
			sessionId: string;
			content: string;
		}) => apiClient.sendMessage(sessionId, { content }),
		onSuccess: (_, { sessionId }) => {
			queryClient.invalidateQueries({
				queryKey: getMessagesQueryKey(sessionId),
			});
		},
	});

	useEffect(() => {
		if (parentSessionId) {
			useResearchStore.getState().setParentSessionId(parentSessionId);
		}
	}, [parentSessionId]);

	useEffect(() => {
		if (researchData?.sessions?.length) {
			const currentIsValid = researchData.sessions.some(
				(s) => s.id === activeResearchSessionId,
			);
			if (!currentIsValid) {
				selectResearchSession(researchData.sessions[0].id);
			}
		} else if (researchData?.sessions?.length === 0) {
			selectResearchSession(null);
		}
	}, [researchData, activeResearchSessionId, selectResearchSession]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, []);

	const adjustTextareaHeight = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
	}, []);

	useEffect(() => {
		adjustTextareaHeight();
	}, [adjustTextareaHeight]);

	const handleCreateNew = useCallback(async () => {
		if (!parentSessionId) return;
		try {
			const result = await createMutation.mutateAsync({
				parentSessionId,
				data: {},
			});
			// Wait for query to refetch before selecting
			await refetch();
			selectResearchSession(result.session.id);
			setShowHistory(false);
		} catch (err) {
			console.error('Failed to create research session:', err);
		}
	}, [parentSessionId, createMutation, selectResearchSession, refetch]);

	const handleSelectSession = useCallback(
		(session: ResearchSession) => {
			selectResearchSession(session.id);
			setShowHistory(false);
		},
		[selectResearchSession],
	);

	const handleInject = useCallback(async () => {
		if (!parentSessionId || !activeResearchSessionId) return;

		// Check if already injected
		const alreadyInjected = parentMessagesData?.some(
			(m) =>
				m.role === 'system' &&
				m.parts?.some(
					(p) =>
						typeof p.content === 'string' &&
						p.content.includes(`from="${activeResearchSessionId}"`),
				),
		);
		if (alreadyInjected) {
			setInjectionStatus('error');
			setTimeout(() => setInjectionStatus('idle'), 3000);
			return;
		}

		// Generate a descriptive label with timestamp
		const now = new Date();
		const timeStr = now.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		});
		const label = `Research ${timeStr}`;

		try {
			await injectMutation.mutateAsync({
				parentSessionId,
				researchSessionId: activeResearchSessionId,
				label,
			});
			setInjectionStatus('success');
			setTimeout(() => setInjectionStatus('idle'), 5000);
			// Invalidate parent messages to update the UI
			queryClient.invalidateQueries({
				queryKey: getMessagesQueryKey(parentSessionId),
			});
		} catch (err) {
			console.error('Failed to inject context:', err);
			setInjectionStatus('error');
			setTimeout(() => setInjectionStatus('idle'), 3000);
		}
	}, [
		parentSessionId,
		activeResearchSessionId,
		injectMutation,
		parentMessagesData,
		queryClient,
	]);

	const handleExport = useCallback(async () => {
		if (!activeResearchSessionId) return;
		try {
			const result = await exportMutation.mutateAsync({
				researchId: activeResearchSessionId,
			});
			if (onNavigateToSession && result.newSession?.id) {
				onNavigateToSession(result.newSession.id);
			}
		} catch (err) {
			console.error('Failed to export to session:', err);
		}
	}, [activeResearchSessionId, exportMutation, onNavigateToSession]);

	const handleSendMessage = useCallback(async () => {
		if (!inputValue.trim() || !parentSessionId) return;
		try {
			let sessionId = activeResearchSessionId;

			if (!sessionId) {
				const result = await createMutation.mutateAsync({
					parentSessionId,
					data: {},
				});
				sessionId = result.session.id;
				selectResearchSession(sessionId);
			}

			await sendMessage.mutateAsync({
				sessionId,
				content: inputValue,
			});
			setInputValue('');
			if (textareaRef.current) {
				textareaRef.current.style.height = 'auto';
			}
		} catch (err) {
			console.error('Failed to send message:', err);
		}
	}, [
		inputValue,
		parentSessionId,
		activeResearchSessionId,
		createMutation,
		selectResearchSession,
		sendMessage,
	]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				handleSendMessage();
			}
		},
		[handleSendMessage],
	);

	const isGenerating = useMemo(
		() =>
			messagesData?.some(
				(m) => m.role === 'assistant' && m.status === 'pending',
			) ?? false,
		[messagesData],
	);

	const isAlreadyInjected = useMemo(() => {
		if (!activeResearchSessionId || !parentMessagesData) return false;
		return parentMessagesData.some(
			(m) =>
				m.role === 'system' &&
				m.parts?.some(
					(p) =>
						typeof p.content === 'string' &&
						p.content.includes(`from="${activeResearchSessionId}"`),
				),
		);
	}, [activeResearchSessionId, parentMessagesData]);

	const handleModelChange = useCallback(
		async (newProvider: string, newModel: string) => {
			if (!activeResearchSessionId) {
				setShowModelSelector(false);
				return;
			}
			try {
				await updateSession.mutateAsync({
					provider: newProvider,
					model: newModel,
				});
				await queryClient.invalidateQueries({
					queryKey: projectScopedKey([
						'research',
						'sessions',
						parentSessionId,
					] as const),
				});
				setShowModelSelector(false);
			} catch (err) {
				console.error('Failed to update research session model:', err);
			}
		},
		[activeResearchSessionId, updateSession, queryClient, parentSessionId],
	);

	const parentSession = useSession(parentSessionId ?? '');

	const sessions = researchData?.sessions ?? [];
	const activeSession = sessions.find((s) => s.id === activeResearchSessionId);
	const messages = messagesData ?? [];

	const effectiveProvider =
		activeSession?.provider ?? parentSession?.provider ?? '';
	const effectiveModel = activeSession?.model ?? parentSession?.model ?? '';

	const currentProviderLabel =
		allModels?.[effectiveProvider]?.label ?? effectiveProvider;
	const currentModelLabel =
		allModels?.[effectiveProvider]?.models.find((m) => m.id === effectiveModel)
			?.label ?? effectiveModel;

	return (
		<div
			className="border-l border-sidebar-border sidebar-fade-in flex h-full relative"
			style={{ width: panelWidth }}
		>
			<ResizeHandle
				panelKey={PANEL_KEY}
				side="right"
				minWidth={MIN_WIDTH}
				maxWidth={MAX_WIDTH}
				defaultWidth={DEFAULT_WIDTH}
			/>
			<div className="flex-1 flex flex-col h-full min-w-0">
				<SidebarHeader
					icon={<FlaskConical className="size-[15px] text-teal-500" />}
					title="Research"
					onClose={collapseSidebar}
				>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => setShowHistory(!showHistory)}
						title="Research history"
						className="h-8 w-8"
					>
						<History className="w-4 h-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleCreateNew}
						disabled={!parentSessionId || createMutation.isPending}
						title="New research session"
						className="h-8 w-8"
					>
						{createMutation.isPending ? (
							<StableSpinner title="Creating research session" />
						) : (
							<Plus className="w-4 h-4" />
						)}
					</Button>
				</SidebarHeader>

				{showHistory ? (
					<div className="flex-1 overflow-y-auto">
						<div className="p-2 border-b border-border">
							<div className="text-xs font-medium text-muted-foreground px-2 py-1">
								Research Sessions
							</div>
						</div>
						{isLoading ? (
							<div className="p-4 text-sm text-muted-foreground">
								Loading...
							</div>
						) : sessions.length === 0 ? (
							<div className="p-4 text-sm text-muted-foreground">
								No research sessions yet
							</div>
						) : (
							<div className="p-2 space-y-1">
								{sessions.map((session) => (
									<button
										type="button"
										key={session.id}
										onClick={() => handleSelectSession(session)}
										className={`w-full text-left p-2 rounded-md text-sm transition-colors ${
											session.id === activeResearchSessionId
												? 'bg-teal-500/10 border border-teal-500/30 text-foreground'
												: 'hover:bg-muted'
										}`}
									>
										<div className="font-medium truncate">
											{session.title || 'Untitled'}
										</div>
										<div className="text-xs text-muted-foreground">
											{session.messageCount} messages •{' '}
											{formatRelativeTime(
												session.lastActiveAt ?? session.createdAt,
											)}
										</div>
									</button>
								))}
							</div>
						)}
					</div>
				) : (
					<>
						{/* Messages area - using the same components as main chat, but smaller */}
						<div className="flex-1 overflow-y-auto px-3 py-3 research-messages text-[13px]">
							{!activeResearchSessionId ? (
								<div className="text-xs text-muted-foreground text-center py-8">
									<FlaskConical className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
									<p>Start researching by asking a question below.</p>
								</div>
							) : messages.length === 0 ? (
								<div className="text-xs text-muted-foreground text-center py-8">
									<p>Ask a question to start researching.</p>
								</div>
							) : (
								<div className="space-y-1.5">
									{messages.map((msg, index) => {
										if (msg.role === 'user') {
											const nextMsg = messages[index + 1];
											return (
												<UserMessageGroup
													key={msg.id}
													sessionId={activeResearchSessionId}
													message={msg}
													isFirst={index === 0}
													nextAssistantMessageId={
														nextMsg?.role === 'assistant'
															? nextMsg.id
															: undefined
													}
												/>
											);
										}
										if (msg.role === 'assistant') {
											const prevMsg = index > 0 ? messages[index - 1] : null;
											const nextMsg = messages[index + 1];
											const showHeader = prevMsg?.role !== 'assistant';
											const hasNextAssistant = nextMsg?.role === 'assistant';
											return (
												<AssistantMessageGroup
													key={msg.id}
													sessionId={activeResearchSessionId}
													message={msg}
													showHeader={showHeader}
													hasNextAssistantMessage={hasNextAssistant}
													isLastMessage={index === messages.length - 1}
													compact
													onNavigateToSession={onNavigateToSession}
												/>
											);
										}
										return null;
									})}
									<div ref={messagesEndRef} />
								</div>
							)}
						</div>

						{/* Input area */}
						<div className="p-3 border-t border-border">
							<div className="relative flex flex-col rounded-3xl bg-card border border-border focus-within:border-teal-500/60 focus-within:ring-1 focus-within:ring-teal-500/40 p-1">
								<div className="flex items-end gap-1">
									<Textarea
										ref={textareaRef}
										value={inputValue}
										onChange={(e) => setInputValue(e.target.value)}
										onKeyDown={handleKeyDown}
										placeholder="Ask anything..."
										disabled={
											!parentSessionId ||
											sendMessage.isPending ||
											createMutation.isPending
										}
										rows={1}
										className="flex-1 border-0 bg-transparent pl-2 pr-1 py-2 max-h-[120px] overflow-y-auto leading-normal resize-none scrollbar-hide text-sm focus:ring-0 focus:outline-none"
										style={{ height: '2.25rem' }}
									/>
									<button
										type="button"
										onClick={handleSendMessage}
										disabled={
											!inputValue.trim() ||
											!parentSessionId ||
											sendMessage.isPending ||
											createMutation.isPending ||
											isGenerating
										}
										className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors flex-shrink-0 ${
											inputValue.trim() && parentSessionId && !isGenerating
												? 'bg-teal-500 hover:bg-teal-600 text-white'
												: 'bg-transparent text-muted-foreground'
										}`}
									>
										{sendMessage.isPending || createMutation.isPending ? (
											<StableSpinner title="Sending research message" />
										) : (
											<ArrowUp className="w-4 h-4" />
										)}
									</button>
								</div>
							</div>

							{/* Injection status banner */}
							{injectionStatus === 'success' && (
								<div className="flex items-center gap-2 mt-2 px-2 py-1.5 text-xs rounded-lg bg-teal-500/10 border border-teal-500/30 text-teal-600 dark:text-teal-400">
									<Check className="w-3 h-3 flex-shrink-0" />
									<span className="flex-1">
										Context injected — will be used on next request
									</span>
									<button
										type="button"
										onClick={() => setInjectionStatus('idle')}
										className="hover:text-teal-500"
									>
										<X className="w-3 h-3" />
									</button>
								</div>
							)}
							{injectionStatus === 'error' && (
								<div className="flex items-center gap-2 mt-2 px-2 py-1.5 text-xs rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400">
									<X className="w-3 h-3 flex-shrink-0" />
									<span className="flex-1">Failed to inject context</span>
									<button
										type="button"
										onClick={() => setInjectionStatus('idle')}
										className="hover:text-red-500"
									>
										<X className="w-3 h-3" />
									</button>
								</div>
							)}

							{/* Action buttons */}
							<div className="flex gap-2 mt-2">
								<button
									type="button"
									onClick={handleInject}
									disabled={
										!activeResearchSessionId ||
										injectMutation.isPending ||
										isGenerating ||
										isAlreadyInjected
									}
									className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
										isAlreadyInjected
											? 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/30'
											: 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground'
									}`}
									title={
										isAlreadyInjected
											? 'Already injected into main session'
											: 'Inject findings into main session'
									}
								>
									{injectMutation.isPending ? (
										<StableSpinner size="xs" title="Injecting context" />
									) : isAlreadyInjected ? (
										<Check className="w-3 h-3" />
									) : (
										<ArrowDownToLine className="w-3 h-3" />
									)}
									{isAlreadyInjected ? 'Injected' : 'Inject'}
								</button>
								<button
									type="button"
									onClick={handleExport}
									disabled={
										!activeResearchSessionId ||
										exportMutation.isPending ||
										isGenerating
									}
									className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
									title="Export to new main session"
								>
									{exportMutation.isPending ? (
										<StableSpinner size="xs" title="Exporting research" />
									) : (
										<ExternalLink className="w-3 h-3" />
									)}
									Export
								</button>
							</div>
						</div>
					</>
				)}

				{/* Footer */}
				<div className="h-12 px-3 border-t border-border text-xs text-muted-foreground flex items-center justify-between">
					<span className="text-[10px]">
						{sessions.length} research session{sessions.length !== 1 ? 's' : ''}
					</span>
					{(currentProviderLabel || currentModelLabel) && (
						<button
							type="button"
							onClick={() => setShowModelSelector(true)}
							className="flex items-center gap-1 text-[10px] hover:text-foreground transition-colors"
						>
							<span className="opacity-60">{currentProviderLabel}</span>
							<span className="opacity-40">/</span>
							<span>{currentModelLabel}</span>
							<ChevronDown className="w-3 h-3 opacity-40" />
						</button>
					)}
				</div>

				{/* Model Selector Modal */}
				<Modal
					isOpen={showModelSelector}
					onClose={() => setShowModelSelector(false)}
					title="Select Model for Research"
					maxWidth="md"
				>
					{(effectiveProvider || effectiveModel) && (
						<UnifiedModelSelector
							provider={effectiveProvider}
							model={effectiveModel}
							onChange={handleModelChange}
						/>
					)}
				</Modal>
			</div>
		</div>
	);
});

function formatRelativeTime(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
