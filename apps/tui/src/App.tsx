import { useSelectionHandler } from '@opentui/react';
import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import {
	removeFromQueue as apiRemoveFromQueue,
	resolveSecureInput,
	retryMessage as apiRetryMessage,
	sendQueuedMessageNow as apiSendQueuedMessageNow,
} from '@ottocode/api';
import {
	estimateModelCostUsd,
	getModelInfo,
	type ProviderId,
} from '@ottocode/sdk';
import { StatusBar } from './components/StatusBar.tsx';
import { ChatView } from './components/ChatView.tsx';
import { ChatInput } from './components/ChatInput.tsx';
import { QueueBar } from './components/QueueBar.tsx';
import { ActiveSubagentsBar } from './components/ActiveSubagentsBar.tsx';
import { Overlays } from './components/Overlays.tsx';
import { ApproveAllBar } from './components/ApproveAllBar.tsx';
import { SecureInputBar } from './components/SecureInputBar.tsx';
import { ActivityPanel } from './components/activity/ActivityPanel.tsx';
import { ActivityDetailPane } from './components/activity/ActivityDetailPane.tsx';
import { useSession } from './hooks/useSession.ts';
import { useStream } from './hooks/useStream.ts';
import { useActivityData } from './hooks/useActivityData.ts';
import { useConfig } from './hooks/useConfig.ts';
import { useGlobalKeymap } from './hooks/useGlobalKeymap.ts';
import { useRecipeCommands } from './hooks/useRecipeCommands.ts';
import {
	executeCommand,
	isLocalTuiCommand,
	parseCommand,
} from './commands/index.ts';
import { copyToClipboard } from './lib/clipboard.ts';
import { moveWorkspaceFocus } from './lib/workspace-navigation.ts';
import {
	getLastFailedAssistantMessage,
	getRetryErrorMessage,
} from './lib/retry.ts';
import {
	getQueuedMessageItems,
	getQueuedMessageSummary,
	type OptimisticQueuedMessage,
	type QueuedMessageItem,
} from './lib/queue.ts';
import { getProjectContext, getProjectQuery } from './api.ts';
import { useTheme } from './theme.ts';
import { useOverlayStore } from './stores/overlay.ts';
import { useWorkspaceStore } from './stores/workspace.ts';
import type { Session } from './types.ts';
import type { ActivitySubagent } from './components/activity/types.ts';
import { useTerminalDimensions } from './terminal-dimensions.tsx';

export function App({
	onQuit,
	webUrl,
	initialSession,
}: {
	onQuit: () => void;
	webUrl?: string;
	initialSession?: {
		agent?: string;
		provider?: string;
		model?: string;
		allowUnknownModel?: boolean;
	};
}) {
	const { colors, setTheme } = useTheme();
	const { width: terminalWidth } = useTerminalDimensions();
	const initialSessionDefaults = useMemo(
		() => initialSession,
		[initialSession],
	);

	const overlay = useOverlayStore((s) => s.overlay);
	const setOverlay = useOverlayStore((s) => s.setOverlay);
	const status = useOverlayStore((s) => s.status);
	const showStatus = useOverlayStore((s) => s.showStatus);
	const escHint = useOverlayStore((s) => s.escHint);
	const setEscHint = useOverlayStore((s) => s.setEscHint);
	const clearEscHint = useOverlayStore((s) => s.clearEscHint);
	const cleanup = useOverlayStore((s) => s.cleanup);
	const workspaceOpen = useWorkspaceStore((s) => s.isOpen);
	const workspaceTab = useWorkspaceStore((s) => s.tab);
	const workspaceFocus = useWorkspaceStore((s) => s.focus);
	const workspaceDetail = useWorkspaceStore((s) => s.detail);
	const toggleWorkspace = useWorkspaceStore((s) => s.toggle);
	const backWorkspace = useWorkspaceStore((s) => s.back);
	const setWorkspaceTab = useWorkspaceStore((s) => s.setTab);
	const setWorkspaceFocus = useWorkspaceStore((s) => s.setFocus);
	const openWorkspaceDetail = useWorkspaceStore((s) => s.openDetail);
	const resetWorkspaceDetail = useWorkspaceStore((s) => s.resetDetail);

	useEffect(() => () => cleanup(), [cleanup]);

	useSelectionHandler((selection) => {
		const text = selection.getSelectedText();
		if (text) {
			copyToClipboard(text).then(() => {
				showStatus({ type: 'success', label: 'copied to clipboard' }, 2000);
			});
		}
	});

	const {
		sessions,
		activeSession,
		hasMore,
		loadingMore,
		loadSessions,
		loadMoreSessions,
		createSession,
		deleteSession,
		switchSession,
		updateSessionMeta,
		updateSessionPrefs,
		refreshActiveSession,
		sendMessage,
		abortSession,
		approveToolCall,
		sessionError,
	} = useSession(initialSessionDefaults);

	useEffect(() => {
		if (sessionError) {
			showStatus({ type: 'error', label: sessionError }, 5000);
		}
	}, [sessionError, showStatus]);

	const { config, isLoaded: isConfigLoaded, updateDefaults } = useConfig();
	const recipeCommands = useRecipeCommands();
	const recipeNames = useMemo(
		() => new Set(recipeCommands.map((command) => command.name)),
		[recipeCommands],
	);

	const themeSyncedRef = useRef(false);
	useEffect(() => {
		if (!themeSyncedRef.current && config.defaults.tuiTheme) {
			setTheme(config.defaults.tuiTheme);
			themeSyncedRef.current = true;
		}
	}, [config.defaults.tuiTheme, setTheme]);

	const sessionId = activeSession?.id ?? null;

	const handleMessageCompleted = useCallback(() => {
		if (sessionId) refreshActiveSession(sessionId);
	}, [sessionId, refreshActiveSession]);

	const lastStepRefreshRef = useRef<number>(0);
	const handleStepFinish = useCallback(() => {
		const now = Date.now();
		if (now - lastStepRefreshRef.current < 2000) return;
		lastStepRefreshRef.current = now;
		if (sessionId) refreshActiveSession(sessionId);
	}, [sessionId, refreshActiveSession]);

	const {
		messages,
		isStreaming,
		streamingMessageId,
		hasOlderMessages,
		isLoadingOlderMessages,
		loadOlderMessages,
		queueSize: serverQueueSize,
		queuedMessageIds,
		pendingApprovals,
		setPendingApprovals,
		pendingSecureInputs,
		setPendingSecureInputs,
		reload,
		dispatch: dispatchStream,
		addOptimisticUser,
	} = useStream(
		sessionId,
		updateSessionMeta,
		handleMessageCompleted,
		handleStepFinish,
	);
	const activityData = useActivityData(sessionId, messages, true);
	const activeSubagents = useMemo(
		() => activityData.subagents.filter((item) => item.status === 'running'),
		[activityData.subagents],
	);
	const [optimisticQueuedMessages, setOptimisticQueuedMessages] = useState<
		OptimisticQueuedMessage[]
	>([]);
	const [composerDraft, setComposerDraft] = useState<{
		id: number;
		text: string;
	} | null>(null);
	const queuedMessages = useMemo(() => {
		const serverItems = getQueuedMessageItems(messages, queuedMessageIds);
		const serverItemsById = new Map(
			serverItems.map((item) => [item.assistantMessageId, item]),
		);
		const usedClientIds = new Set<string>();
		const items = [...queuedMessageIds].flatMap((assistantMessageId) => {
			const optimisticItem =
				optimisticQueuedMessages.find(
					(item) => item.assistantMessageId === assistantMessageId,
				) ??
				optimisticQueuedMessages.find(
					(item) =>
						!item.assistantMessageId && !usedClientIds.has(item.clientId),
				);
			if (optimisticItem) {
				usedClientIds.add(optimisticItem.clientId);
				return [
					{
						assistantMessageId,
						userMessageId: optimisticItem.clientId,
						summary: optimisticItem.summary,
						content: optimisticItem.content,
					},
				];
			}
			const serverItem = serverItemsById.get(assistantMessageId);
			return serverItem ? [serverItem] : [];
		});
		for (const optimisticItem of optimisticQueuedMessages) {
			if (
				usedClientIds.has(optimisticItem.clientId) ||
				(optimisticItem.assistantMessageId &&
					queuedMessageIds.has(optimisticItem.assistantMessageId))
			) {
				continue;
			}
			items.push({
				assistantMessageId:
					optimisticItem.assistantMessageId ?? optimisticItem.clientId,
				userMessageId: optimisticItem.clientId,
				summary: optimisticItem.summary,
				content: optimisticItem.content,
			});
		}
		return items;
	}, [messages, queuedMessageIds, optimisticQueuedMessages]);
	const queueSize = Math.max(serverQueueSize, queuedMessages.length);

	useEffect(() => {
		void sessionId;
		resetWorkspaceDetail();
		setOptimisticQueuedMessages([]);
	}, [sessionId, resetWorkspaceDetail]);

	useEffect(() => {
		setOptimisticQueuedMessages((current) =>
			current
				.map((item) =>
					item.assistantMessageId &&
					queuedMessageIds.has(item.assistantMessageId)
						? { ...item, confirmed: true }
						: item,
				)
				.filter(
					(item) =>
						!item.confirmed ||
						Boolean(
							item.assistantMessageId &&
								queuedMessageIds.has(item.assistantMessageId),
						),
				),
		);
	}, [queuedMessageIds]);

	const contextTokens = activeSession?.currentContextTokens ?? 0;
	const sessionProvider = activeSession?.provider ?? '';
	const sessionModel = activeSession?.model ?? '';
	const totalIn = activeSession?.totalInputTokens ?? 0;
	const totalOut = activeSession?.totalOutputTokens ?? 0;
	const totalCached = activeSession?.totalCachedTokens ?? 0;
	const totalCacheCreation = activeSession?.totalCacheCreationTokens ?? 0;
	const totalCostUsd = activeSession?.totalCostUsd;

	const estimatedCost = useMemo(() => {
		if (typeof totalCostUsd === 'number') return totalCostUsd;
		if (!sessionProvider) return 0;
		return (
			estimateModelCostUsd(sessionProvider as ProviderId, sessionModel, {
				inputTokens: totalIn,
				outputTokens: totalOut,
				cachedInputTokens: totalCached,
				cacheCreationInputTokens: totalCacheCreation,
			}) ?? 0
		);
	}, [
		sessionProvider,
		sessionModel,
		totalIn,
		totalOut,
		totalCached,
		totalCacheCreation,
		totalCostUsd,
	]);

	const contextUsagePercent = useMemo(() => {
		if (!sessionProvider || !contextTokens) return 0;
		const info = getModelInfo(sessionProvider as ProviderId, sessionModel);
		const limit = info?.limit?.context;
		if (!limit) return 0;
		return (contextTokens / limit) * 100;
	}, [sessionProvider, sessionModel, contextTokens]);

	const handleSendQueuedMessage = useCallback(
		async (messageId: string): Promise<boolean> => {
			if (!sessionId) return false;
			try {
				const response = await apiSendQueuedMessageNow({
					path: { sessionId, messageId },
					query: getProjectQuery(),
				} as never);
				if (response.error) return false;
				setTimeout(reload, 150);
				return true;
			} catch {
				return false;
			}
		},
		[sessionId, reload],
	);

	const handleRemoveQueuedMessage = useCallback(
		async (messageId: string): Promise<boolean> => {
			if (!sessionId) return false;
			try {
				const response = await apiRemoveFromQueue({
					path: { sessionId, messageId },
					query: getProjectQuery(),
				} as never);
				if (response.error) return false;
				const queuedItem = getQueuedMessageItems(
					messages,
					new Set([messageId]),
				)[0];
				dispatchStream({
					type: 'REMOVE_MESSAGES',
					messageIds: queuedItem
						? [messageId, queuedItem.userMessageId]
						: [messageId],
				});
				setOptimisticQueuedMessages((current) =>
					current.filter(
						(item) =>
							item.assistantMessageId !== messageId &&
							item.clientId !== messageId,
					),
				);
				setTimeout(reload, 150);
				return true;
			} catch {
				return false;
			}
		},
		[sessionId, reload, messages, dispatchStream],
	);

	const handleRestoreQueuedMessage = useCallback(
		async (item: QueuedMessageItem): Promise<boolean> => {
			const removed = await handleRemoveQueuedMessage(item.assistantMessageId);
			if (!removed) return false;
			setComposerDraft({ id: Date.now(), text: item.content });
			return true;
		},
		[handleRemoveQueuedMessage],
	);

	const handleCommand = useCallback(
		(name: string, args: string) =>
			executeCommand(name, args, {
				activeSession,
				webUrl,
				reasoningText: config.defaults.reasoningText ?? true,
				onQuit,
				setOverlay,
				showStatus,
				loadSessions,
				createSession,
				deleteSession,
				switchSession,
				updateSessionPrefs,
				sendMessage: async (nextSessionId, content) => {
					await sendMessage(nextSessionId, content);
				},
				abortSession,
				updateDefaults,
				reload,
			}),
		[
			activeSession,
			webUrl,
			config.defaults.reasoningText,
			onQuit,
			setOverlay,
			showStatus,
			loadSessions,
			createSession,
			deleteSession,
			switchSession,
			updateSessionPrefs,
			sendMessage,
			abortSession,
			updateDefaults,
			reload,
		],
	);

	const handleSubmit = useCallback(
		async (text: string, images?: unknown[], files?: unknown[]) => {
			const cmd = parseCommand(text);
			if (cmd && isLocalTuiCommand(cmd.name)) {
				await handleCommand(cmd.name, cmd.args);
				return;
			}

			const attachmentNames = [
				...((images as { name?: string }[]) ?? [])
					.map((i) => i.name)
					.filter(Boolean),
				...((files as { name?: string }[]) ?? [])
					.map((f) => f.name)
					.filter(Boolean),
			] as string[];

			if (!activeSession) {
				const session = await createSession();
				if (session) {
					addOptimisticUser(
						text,
						attachmentNames.length > 0 ? attachmentNames : undefined,
					);
					await new Promise((r) => setTimeout(r, 150));
					await sendMessage(session.id, text, images, files);
				}
				return;
			}

			if (isStreaming && streamingMessageId) {
				const clientId = `optimistic-queue-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2, 8)}`;
				setOptimisticQueuedMessages((current) => [
					...current,
					{
						clientId,
						assistantMessageId: null,
						summary: getQueuedMessageSummary(text, attachmentNames),
						content: text,
						confirmed: false,
					},
				]);
				const assistantMessageId = await sendMessage(
					activeSession.id,
					text,
					images,
					files,
				);
				setOptimisticQueuedMessages((current) =>
					assistantMessageId
						? current.map((item) =>
								item.clientId === clientId
									? {
											...item,
											assistantMessageId,
											confirmed: queuedMessageIds.has(assistantMessageId),
										}
									: item,
							)
						: current.filter((item) => item.clientId !== clientId),
				);
				return;
			}

			addOptimisticUser(
				text,
				attachmentNames.length > 0 ? attachmentNames : undefined,
			);
			await sendMessage(activeSession.id, text, images, files);
		},
		[
			activeSession,
			createSession,
			handleCommand,
			sendMessage,
			addOptimisticUser,
			isStreaming,
			streamingMessageId,
			queuedMessageIds,
		],
	);

	const handleSessionSelect = useCallback(
		(session: Session) => {
			switchSession(session);
			setOverlay('none');
		},
		[switchSession, setOverlay],
	);

	const sessionIdRef = useRef(activeSession?.id);
	sessionIdRef.current = activeSession?.id;

	const handleApprove = useCallback(
		async (callId: string) => {
			const sid = sessionIdRef.current;
			if (!sid) return;
			await approveToolCall(sid, callId, true);
			setPendingApprovals((prev) => prev.filter((a) => a.callId !== callId));
		},
		[approveToolCall, setPendingApprovals],
	);

	const handleDeny = useCallback(
		async (callId: string) => {
			const sid = sessionIdRef.current;
			if (!sid) return;
			await approveToolCall(sid, callId, false);
			setPendingApprovals((prev) => prev.filter((a) => a.callId !== callId));
		},
		[approveToolCall, setPendingApprovals],
	);

	const handleApproveAll = useCallback(async () => {
		const sid = sessionIdRef.current;
		if (!sid) return;
		await Promise.all(
			pendingApprovals.map((a) => approveToolCall(sid, a.callId, true)),
		);
		setPendingApprovals([]);
	}, [approveToolCall, pendingApprovals, setPendingApprovals]);

	const handleSecureInputSubmit = useCallback(
		async (promptId: string, value: string) => {
			const sid = sessionIdRef.current;
			if (!sid) return;
			const response = await resolveSecureInput({
				path: { id: sid },
				query: getProjectQuery(),
				body: { promptId, value },
			} as never);
			if (response.error) {
				showStatus({ type: 'error', label: 'secure input failed' }, 3000);
				return;
			}
			setPendingSecureInputs((prev) =>
				prev.filter((input) => input.promptId !== promptId),
			);
		},
		[setPendingSecureInputs, showStatus],
	);

	const handleSecureInputCancel = useCallback(
		async (promptId: string) => {
			const sid = sessionIdRef.current;
			if (!sid) return;
			const response = await resolveSecureInput({
				path: { id: sid },
				query: getProjectQuery(),
				body: { promptId, cancelled: true },
			} as never);
			if (response.error) {
				showStatus(
					{ type: 'error', label: 'secure input cancel failed' },
					3000,
				);
				return;
			}
			setPendingSecureInputs((prev) =>
				prev.filter((input) => input.promptId !== promptId),
			);
		},
		[setPendingSecureInputs, showStatus],
	);

	const abortActiveSession = useCallback(() => {
		const sid = sessionIdRef.current;
		if (sid) abortSession(sid);
	}, [abortSession]);

	const openSessions = useCallback(() => {
		loadSessions().then(() => setOverlay('sessions'));
	}, [loadSessions, setOverlay]);

	const handleToggleWorkspace = useCallback(() => {
		toggleWorkspace();
	}, [toggleWorkspace]);

	const handleCycleWorkspaceFocus = useCallback(() => {
		const state = useWorkspaceStore.getState();
		if (!state.isOpen && !state.detail) {
			state.open();
			return;
		}
		if (state.focus === 'chat') {
			state.setFocus(state.detail ? 'detail' : 'activity');
		} else if (state.focus === 'detail') {
			state.setFocus(state.isOpen ? 'activity' : 'chat');
		} else {
			state.setFocus('chat');
		}
	}, []);

	const handleMoveWorkspaceFocus = useCallback(
		(direction: 'left' | 'right') => {
			const state = useWorkspaceStore.getState();
			const threePane =
				(terminalWidth || (process.stdout.columns ?? 120)) >= 140;
			state.setFocus(
				moveWorkspaceFocus(
					{
						focus: state.focus,
						showDetail: !!state.detail,
						showActivity: state.isOpen && (!state.detail || threePane),
					},
					direction,
				),
			);
		},
		[terminalWidth],
	);

	const lastFailedMessage = useMemo(
		() => getLastFailedAssistantMessage(messages),
		[messages],
	);

	const handleRetryLastFailedMessage = useCallback(async () => {
		if (!activeSession || isStreaming) return;
		const failedMessage = getLastFailedAssistantMessage(messages);
		if (!failedMessage) {
			showStatus({ type: 'error', label: 'no failed request to retry' }, 2500);
			return;
		}

		showStatus({ type: 'loading', label: 'retrying request' });
		try {
			const response = await apiRetryMessage({
				path: {
					sessionId: activeSession.id,
					messageId: failedMessage.id,
				},
				query: getProjectQuery(),
			} as never);
			if (response.error) throw new Error(getRetryErrorMessage(response.error));
			dispatchStream({
				type: 'RETRY_MESSAGE',
				messageId: failedMessage.id,
			});
			showStatus({ type: 'success', label: 'request retried' }, 2000);
		} catch (error) {
			showStatus({ type: 'error', label: getRetryErrorMessage(error) }, 5000);
		}
	}, [activeSession, isStreaming, messages, showStatus, dispatchStream]);

	const handleAgentSelect = useCallback(
		async (agent: string) => {
			if (activeSession) {
				await updateSessionPrefs(activeSession.id, { agent });
			} else {
				const s = await createSession();
				if (s) await updateSessionPrefs(s.id, { agent });
			}
			showStatus({ type: 'success', label: `agent: ${agent}` }, 2000);
		},
		[activeSession, updateSessionPrefs, createSession, showStatus],
	);

	const handleCycleAgent = useCallback(() => {
		const agents = config.agents;
		if (agents.length === 0) return;
		const current =
			activeSession?.agent ||
			initialSessionDefaults?.agent ||
			(isConfigLoaded ? config.defaults.agent : 'build');
		const currentIndex = agents.indexOf(current);
		const nextIndex =
			currentIndex >= 0 ? (currentIndex + 1) % agents.length : 0;
		const nextAgent = agents[nextIndex];
		if (!nextAgent || nextAgent === current) return;
		void handleAgentSelect(nextAgent);
	}, [
		config.agents,
		config.defaults.agent,
		activeSession?.agent,
		initialSessionDefaults?.agent,
		isConfigLoaded,
		handleAgentSelect,
	]);

	useGlobalKeymap({
		overlay,
		isStreaming,
		hasActiveSession: !!activeSession,
		hasSecureInput: pendingSecureInputs.length > 0,
		isWorkspaceFocused: workspaceFocus !== 'chat',
		escHint,
		setEscHint,
		clearEscHint,
		setOverlay,
		createSession,
		openSessions,
		retryLastFailedMessage: handleRetryLastFailedMessage,
		abortActiveSession,
		toggleWorkspace: handleToggleWorkspace,
		focusWorkspace: handleCycleWorkspaceFocus,
		moveWorkspaceFocus: handleMoveWorkspaceFocus,
		backWorkspace,
		cycleAgent: handleCycleAgent,
		onQuit,
	});

	useEffect(() => {
		if (!isStreaming) {
			clearEscHint();
		}
	}, [isStreaming, clearEscHint]);

	const provider =
		activeSession?.provider ||
		initialSessionDefaults?.provider ||
		(isConfigLoaded ? config.defaults.provider : '');
	const model =
		activeSession?.model ||
		initialSessionDefaults?.model ||
		(isConfigLoaded ? config.defaults.model : '');
	const currentAgent =
		activeSession?.agent ||
		initialSessionDefaults?.agent ||
		(isConfigLoaded ? config.defaults.agent : 'build');

	const handlePlanModeToggle = useCallback(
		async (isPlanMode: boolean) => {
			const newAgent = isPlanMode ? 'plan' : 'build';
			if (activeSession) {
				await updateSessionPrefs(activeSession.id, { agent: newAgent });
			} else {
				const s = await createSession();
				if (s) await updateSessionPrefs(s.id, { agent: newAgent });
			}
		},
		[activeSession, updateSessionPrefs, createSession],
	);

	const handleModelSelect = useCallback(
		(p: string, m: string) => {
			if (activeSession) {
				updateSessionPrefs(activeSession.id, { provider: p, model: m });
			} else {
				createSession().then((s) => {
					if (s) updateSessionPrefs(s.id, { provider: p, model: m });
				});
			}
		},
		[activeSession, updateSessionPrefs, createSession],
	);

	const handleThemeSave = useCallback(
		(name: string) => updateDefaults({ tuiTheme: name }),
		[updateDefaults],
	);

	const handleApprovalModeSave = useCallback(
		(mode: 'auto' | 'dangerous' | 'all' | 'yolo') =>
			updateDefaults({ toolApproval: mode }),
		[updateDefaults],
	);

	const layoutWidth = terminalWidth || (process.stdout.columns ?? 120);
	const showThreePane = layoutWidth >= 140;
	const showDetail = !!workspaceDetail;
	const showActivity = workspaceOpen && (!workspaceDetail || showThreePane);
	const activityWidth =
		Math.floor(
			(showThreePane
				? 56
				: Math.max(52, Math.min(60, Math.floor(layoutWidth * 0.42)))) / 4,
		) * 4;
	const detailWidth = showThreePane
		? Math.max(42, Math.min(64, Math.floor(layoutWidth * 0.34)))
		: Math.max(30, Math.min(58, Math.floor(layoutWidth * 0.42)));
	const chatPaneWidth =
		layoutWidth -
		2 -
		(showDetail ? detailWidth + 1 : 0) -
		(showActivity ? activityWidth + 1 : 0);
	const emptyStateInputWidth = chatPaneWidth < 80 ? '100%' : '64%';
	const isNewSession = !messages.some(
		(message) =>
			message.role === 'user' ||
			(message.role === 'assistant' &&
				(message.status !== 'pending' ||
					(message.parts?.length ?? 0) > 0 ||
					message.id === streamingMessageId)),
	);

	const handleSubagentSelect = useCallback(
		(subagent: ActivitySubagent) => {
			setOverlay('none');
			setWorkspaceTab('subagents');
			openWorkspaceDetail({ kind: 'subagent', id: subagent.id });
		},
		[setOverlay, setWorkspaceTab, openWorkspaceDetail],
	);

	const chatInput = (
		<ChatInput
			onSubmit={handleSubmit}
			disabled={
				pendingApprovals.length > 0 ||
				pendingSecureInputs.length > 0 ||
				overlay !== 'none' ||
				workspaceFocus !== 'chat'
			}
			status={status}
			isStreaming={isStreaming}
			agent={currentAgent}
			provider={provider}
			model={model}
			escHint={escHint}
			isPlanMode={currentAgent === 'plan'}
			paneActive={workspaceFocus === 'chat'}
			releaseToSend={config.defaults.releaseToSend}
			onPlanModeToggle={handlePlanModeToggle}
			recipeCommands={recipeCommands}
			draftToRestore={composerDraft}
		/>
	);

	return (
		<box
			style={{
				width: '100%',
				height: '100%',
				flexDirection: 'column',
				backgroundColor: colors.bg,
				paddingBottom: 1,
			}}
		>
			<StatusBar
				sessionTitle={activeSession?.title ?? null}
				projectRoot={getProjectContext().projectRoot}
				contextTokens={contextTokens}
				estimatedCost={estimatedCost}
				contextUsagePercent={contextUsagePercent}
			/>

			<box
				style={{
					width: '100%',
					flexGrow: 1,
					flexDirection: 'row',
					paddingLeft: 1,
					paddingRight: 1,
					gap: 1,
				}}
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI panes use mouse focus without DOM roles */}
				<box
					focusable
					onMouseDown={() => setWorkspaceFocus('chat')}
					style={{
						flexGrow: 1,
						height: '100%',
						minWidth: 0,
						flexDirection: 'column',
						backgroundColor:
							workspaceFocus === 'chat' ? colors.bg : colors.bgDark,
					}}
				>
					<ChatView
						messages={messages}
						isStreaming={isStreaming}
						streamingMessageId={streamingMessageId}
						queuedMessageIds={queuedMessageIds}
						pendingApprovals={pendingApprovals}
						onApprove={handleApprove}
						onDeny={handleDeny}
						recipeNames={recipeNames}
						emptyStateInput={isNewSession ? chatInput : undefined}
						emptyStateInputWidth={emptyStateInputWidth}
						hasOlderMessages={hasOlderMessages}
						isLoadingOlderMessages={isLoadingOlderMessages}
						onLoadOlderMessages={loadOlderMessages}
						retryMessageId={isStreaming ? null : lastFailedMessage?.id}
					/>

					{pendingApprovals.length > 0 && (
						<ApproveAllBar
							approvals={pendingApprovals}
							onApprove={handleApprove}
							onApproveAll={handleApproveAll}
							onDeny={handleDeny}
						/>
					)}

					<QueueBar
						count={queueSize}
						nextMessage={queuedMessages[0]?.summary}
					/>
					<ActiveSubagentsBar items={activeSubagents} />

					{!isNewSession && chatInput}
				</box>
				{showDetail && workspaceDetail ? (
					<box
						style={{
							width: detailWidth,
							height: '100%',
							flexShrink: 0,
						}}
					>
						<ActivityDetailPane
							detail={workspaceDetail}
							data={activityData}
							focused={workspaceFocus === 'detail'}
							onFocusRequest={() => setWorkspaceFocus('detail')}
						/>
					</box>
				) : null}
				{showActivity ? (
					<box
						style={{
							width: activityWidth,
							height: '100%',
							flexShrink: 0,
						}}
					>
						<ActivityPanel
							data={activityData}
							tab={workspaceTab}
							panelWidth={activityWidth}
							focused={workspaceFocus === 'activity'}
							onTabChange={setWorkspaceTab}
							onOpenDetail={openWorkspaceDetail}
							onFocusRequest={() => setWorkspaceFocus('activity')}
						/>
					</box>
				) : null}
			</box>

			<Overlays
				sessions={sessions}
				currentSessionId={activeSession?.id}
				queuedMessages={queuedMessages}
				subagents={activityData.subagents}
				hasMore={hasMore}
				loadingMore={loadingMore}
				onLoadMore={loadMoreSessions}
				onSessionSelect={handleSessionSelect}
				provider={provider}
				model={model}
				onModelSelect={handleModelSelect}
				onThemeSave={handleThemeSave}
				approvalMode={config.defaults.toolApproval ?? 'auto'}
				onApprovalModeSave={handleApprovalModeSave}
				currentAgent={currentAgent}
				onAgentSelect={handleAgentSelect}
				onSendQueuedMessage={handleSendQueuedMessage}
				onRemoveQueuedMessage={handleRemoveQueuedMessage}
				onRestoreQueuedMessage={handleRestoreQueuedMessage}
				onSubagentSelect={handleSubagentSelect}
			/>
			{pendingSecureInputs.length > 0 && (
				<SecureInputBar
					key={pendingSecureInputs[0].promptId}
					pendingInput={pendingSecureInputs[0]}
					onSubmit={handleSecureInputSubmit}
					onCancel={handleSecureInputCancel}
				/>
			)}
		</box>
	);
}
