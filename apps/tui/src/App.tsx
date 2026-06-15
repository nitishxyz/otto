import { useKeyboard, useRenderer } from '@opentui/react';
import { useCallback, useEffect, useRef, useMemo } from 'react';
import {
	createSessionHandoff,
	resolveSecureInput,
	stageFiles,
	shareSession,
	syncShare,
	pushCommits,
} from '@ottocode/api';
import {
	estimateModelCostUsd,
	getModelInfo,
	openAuthUrl,
	type ProviderId,
} from '@ottocode/sdk';
import { StatusBar } from './components/StatusBar.tsx';
import { ChatView } from './components/ChatView.tsx';
import { ChatInput } from './components/ChatInput.tsx';
import { Overlays } from './components/Overlays.tsx';
import { ApproveAllBar } from './components/ApproveAllBar.tsx';
import { SecureInputBar } from './components/SecureInputBar.tsx';
import { useSession } from './hooks/useSession.ts';
import { useStream } from './hooks/useStream.ts';
import { useConfig } from './hooks/useConfig.ts';
import { parseCommand, resolveCommand } from './commands.ts';
import { getBaseUrl } from './api.ts';
import { useTheme } from './theme.ts';
import { useOverlayStore } from './stores/overlay.ts';
import type { Session } from './types.ts';

async function copyToClipboard(text: string): Promise<void> {
	const cmd =
		process.platform === 'darwin'
			? 'pbcopy'
			: process.platform === 'win32'
				? 'clip'
				: 'xclip -selection clipboard';
	const proc = Bun.spawn(['sh', '-c', cmd], {
		stdin: 'pipe',
	});
	proc.stdin.write(text);
	proc.stdin.end();
	await proc.exited;
}

function buildWebSessionUrl(
	webUrl: string | undefined,
	sessionId?: string,
): string {
	const url = new URL(webUrl ?? getBaseUrl());
	if (!webUrl) {
		const apiPort = Number(url.port);
		if (apiPort) url.port = String(apiPort + 1);
	}
	url.pathname = sessionId
		? `/sessions/${encodeURIComponent(sessionId)}`
		: '/sessions';
	url.search = '';
	url.hash = '';
	return url.toString();
}

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
	const renderer = useRenderer();
	const { colors, setTheme } = useTheme();
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

	useEffect(() => () => cleanup(), [cleanup]);

	useEffect(() => {
		const handler = (selection: { getSelectedText: () => string }) => {
			const text = selection.getSelectedText();
			if (text) {
				copyToClipboard(text).then(() => {
					showStatus({ type: 'success', label: 'copied to clipboard' }, 2000);
				});
			}
		};
		renderer.on('selection', handler);
		return () => {
			renderer.off('selection', handler);
		};
	}, [renderer, showStatus]);

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
	} = useSession(initialSessionDefaults);

	const { config, isLoaded: isConfigLoaded, updateDefaults } = useConfig();

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
		queueSize,
		queuedMessageIds,
		pendingApprovals,
		setPendingApprovals,
		pendingSecureInputs,
		setPendingSecureInputs,
		reload,
		addOptimisticUser,
	} = useStream(
		sessionId,
		updateSessionMeta,
		handleMessageCompleted,
		handleStepFinish,
	);

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

	const handleCommand = useCallback(
		async (name: string, args: string) => {
			const cmd = resolveCommand(name);
			switch (cmd) {
				case 'exit':
					onQuit();
					break;
				case 'sessions':
					await loadSessions();
					setOverlay('sessions');
					break;
				case 'new': {
					const session = await createSession(args || undefined);
					if (session) setOverlay('none');
					break;
				}
				case 'delete':
					if (activeSession) {
						await deleteSession(activeSession.id);
					}
					break;
				case 'mcp':
					setOverlay('mcp');
					break;
				case 'skills':
					setOverlay('skills');
					break;
				case 'models':
					setOverlay('models');
					break;
				case 'agents':
					setOverlay('agents');
					break;
				case 'commit':
					setOverlay('commit');
					break;
				case 'push':
					showStatus({ type: 'loading', label: 'pushing…' });
					try {
						// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
						const pushResponse = await pushCommits({ body: {} as any });
						if (pushResponse.error) {
							// biome-ignore lint/suspicious/noExplicitAny: SDK error type
							const err = pushResponse.error as any;
							showStatus(
								{ type: 'error', label: err?.error || 'push failed' },
								3000,
							);
						} else {
							// biome-ignore lint/suspicious/noExplicitAny: SDK response type
							const pushData = pushResponse.data as any;
							showStatus(
								{ type: 'success', label: pushData?.data?.output || 'pushed' },
								3000,
							);
						}
					} catch {
						showStatus({ type: 'error', label: 'push failed' }, 3000);
					}
					break;
				case 'web': {
					const sessionWebUrl = buildWebSessionUrl(webUrl, activeSession?.id);
					let copied = false;
					try {
						await copyToClipboard(sessionWebUrl);
						copied = true;
					} catch {}
					const opened = await openAuthUrl(sessionWebUrl);
					if (opened && copied) {
						showStatus({ type: 'success', label: 'web opened & copied' }, 3000);
					} else if (opened) {
						showStatus({ type: 'success', label: 'web opened' }, 3000);
					} else if (copied) {
						showStatus({ type: 'success', label: 'web url copied' }, 3000);
					} else {
						showStatus({ type: 'error', label: 'could not open web' }, 3000);
					}
					break;
				}
				case 'stage':
					try {
						// biome-ignore lint/suspicious/noExplicitAny: SDK body type mismatch
						await stageFiles({ body: { files: ['.'] } as any });
						showStatus({ type: 'success', label: 'staged all' }, 3000);
					} catch {
						showStatus({ type: 'error', label: 'stage failed' }, 3000);
					}
					break;
				case 'help':
					setOverlay('help');
					break;
				case 'theme':
					setOverlay('theme');
					break;
				case 'approvals':
					setOverlay('approvals');
					break;
				case 'usage':
					setOverlay('usage');
					break;
				case 'clear':
					reload();
					break;
				case 'provider':
					if (args) {
						if (activeSession) {
							await updateSessionPrefs(activeSession.id, { provider: args });
						} else {
							const s = await createSession();
							if (s) await updateSessionPrefs(s.id, { provider: args });
						}
					}
					break;
				case 'compact':
					if (activeSession) {
						await sendMessage(activeSession.id, '/compact');
					}
					break;
				case 'init':
					if (activeSession) {
						await sendMessage(activeSession.id, '/init');
					}
					break;
				case 'handoff':
					if (activeSession) {
						showStatus({ type: 'loading', label: 'creating handoff…' });
						try {
							const response = await createSessionHandoff({
								path: { sessionId: activeSession.id },
							});
							if (
								response.error ||
								typeof response.data?.sessionId !== 'string'
							) {
								throw new Error('handoff failed');
							}
							const updatedSessions = await loadSessions();
							const next = updatedSessions.find(
								(s) => s.id === response.data?.sessionId,
							);
							if (next) switchSession(next);
							showStatus({ type: 'success', label: 'handoff created' }, 3000);
						} catch {
							showStatus({ type: 'error', label: 'handoff failed' }, 3000);
						}
					}
					break;
				case 'stop':
					if (activeSession) {
						await abortSession(activeSession.id);
					}
					break;
				case 'reasoning':
					await updateDefaults({
						reasoningText: !(config.defaults.reasoningText ?? true),
					});
					break;
				case 'share':
					if (activeSession) {
						showStatus({ type: 'loading', label: 'sharing…' });
						try {
							const shareResponse = await shareSession({
								path: { sessionId: activeSession.id },
							});
							// biome-ignore lint/suspicious/noExplicitAny: SDK response structure
							const shareData = shareResponse.data as any;
							const shareUrl = shareData?.url;
							if (shareUrl) {
								await copyToClipboard(shareUrl);
								showStatus({ type: 'success', label: 'url copied' }, 3000);
							} else {
								showStatus({ type: 'error', label: 'share failed' }, 3000);
							}
						} catch {
							showStatus({ type: 'error', label: 'share failed' }, 3000);
						}
					}
					break;
				case 'sync':
					if (activeSession) {
						showStatus({ type: 'loading', label: 'syncing…' });
						try {
							const syncResponse = await syncShare({
								path: { sessionId: activeSession.id },
							});
							// biome-ignore lint/suspicious/noExplicitAny: SDK response structure
							const syncData = syncResponse.data as any;
							const syncUrl = syncData?.url;
							if (syncUrl) {
								await copyToClipboard(syncUrl);
								showStatus({ type: 'success', label: 'synced & copied' }, 3000);
							} else {
								showStatus({ type: 'error', label: 'sync failed' }, 3000);
							}
						} catch {
							showStatus({ type: 'error', label: 'sync failed' }, 3000);
						}
					}
					break;
			}
		},
		[
			activeSession,
			config,
			createSession,
			deleteSession,
			loadSessions,
			onQuit,
			reload,
			webUrl,
			updateDefaults,
			sendMessage,
			abortSession,
			showStatus,
			setOverlay,
			switchSession,
			updateSessionPrefs,
		],
	);

	const handleSubmit = useCallback(
		async (text: string, images?: unknown[], files?: unknown[]) => {
			const cmd = parseCommand(text);
			if (cmd) {
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
				body: { promptId, value },
			});
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
				body: { promptId, cancelled: true },
			});
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

	useKeyboard((key) => {
		if (pendingSecureInputs.length > 0 && !(key.ctrl && key.name === 'c')) {
			return;
		}
		if (key.name === 'escape') {
			if (overlay !== 'none') {
				setOverlay('none');
				return;
			}
			if (isStreaming && activeSession) {
				if (escHint) {
					abortSession(activeSession.id);
					clearEscHint();
				} else {
					setEscHint(true);
				}
				return;
			}
		}
		if (key.ctrl && key.name === 'n') {
			createSession();
			return;
		}
		if (key.ctrl && key.name === 's') {
			loadSessions().then(() => setOverlay('sessions'));
			return;
		}
		if (key.ctrl && key.name === 'p') {
			setOverlay('models');
			return;
		}
		if (key.ctrl && key.name === 't') {
			setOverlay('theme');
			return;
		}
		if (key.ctrl && key.name === 'm') {
			setOverlay('mcp');
			return;
		}
		if (key.ctrl && key.name === 'c') {
			if (isStreaming && activeSession) {
				abortSession(activeSession.id);
				clearEscHint();
			} else {
				onQuit();
			}
		}
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
				queueSize={queueSize}
				contextTokens={contextTokens}
				estimatedCost={estimatedCost}
				contextUsagePercent={contextUsagePercent}
			/>

			<ChatView
				messages={messages}
				isStreaming={isStreaming}
				streamingMessageId={streamingMessageId}
				queuedMessageIds={queuedMessageIds}
				pendingApprovals={pendingApprovals}
				onApprove={handleApprove}
				onDeny={handleDeny}
			/>

			{pendingApprovals.length > 0 && (
				<ApproveAllBar
					approvals={pendingApprovals}
					onApprove={handleApprove}
					onApproveAll={handleApproveAll}
					onDeny={handleDeny}
				/>
			)}

			{pendingSecureInputs.length > 0 && (
				<SecureInputBar
					pendingInput={pendingSecureInputs[0]}
					onSubmit={handleSecureInputSubmit}
					onCancel={handleSecureInputCancel}
				/>
			)}

			<ChatInput
				onSubmit={handleSubmit}
				disabled={
					pendingApprovals.length > 0 ||
					pendingSecureInputs.length > 0 ||
					overlay !== 'none'
				}
				status={status}
				isStreaming={isStreaming}
				agent={currentAgent}
				provider={provider}
				model={model}
				escHint={escHint}
				isPlanMode={currentAgent === 'plan'}
				onPlanModeToggle={handlePlanModeToggle}
			/>

			<Overlays
				sessions={sessions}
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
			/>
		</box>
	);
}
