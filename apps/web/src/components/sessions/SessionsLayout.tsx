import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../layout/AppLayout';
import {
	SessionListContainer,
	MessageThreadContainer,
	ChatInputContainer,
	NewSessionLanding,
	type ChatInputContainerRef,
	Toaster,
	OttoSessionRail,
	OttoWorkspace,
} from '@ottocode/web-sdk/components';
import {
	useCreateSession,
	useConfig,
	useTheme,
	useWorkingDirectory,
	useKeyboardShortcuts,
	useClientEvents,
	sessionsQueryKey,
} from '@ottocode/web-sdk/hooks';
import {
	useGitStore,
	useConfirmationStore,
	useWorkspaceTabStore,
} from '@ottocode/web-sdk/stores';

import { apiClient } from '@ottocode/web-sdk/lib';
import {
	useStageFiles,
	useOttoRouterBalance,
	useOttoRouterPayments,
	useUnstageFiles,
	useRestoreFiles,
	useDeleteFiles,
} from '@ottocode/web-sdk/hooks';

interface SessionsCachePage {
	items?: Array<{ id: string }>;
}

interface SessionsCacheData {
	pages?: SessionsCachePage[];
}

interface SessionsLayoutProps {
	sessionId?: string;
	/** Workspace view: 'agents' (default, /sessions) or 'otto' (/otto). */
	view?: 'agents' | 'otto';
}

export function SessionsLayout({
	sessionId,
	view = 'agents',
}: SessionsLayoutProps) {
	const chatInputRef = useRef<ChatInputContainerRef>(null);
	const createSession = useCreateSession();
	const { data: config } = useConfig();
	const { theme, toggleTheme } = useTheme();
	const navigate = useNavigate();
	const isOttoTab = view === 'otto';

	const focusInput = useCallback(() => {
		setTimeout(() => {
			chatInputRef.current?.focus();
		}, 100);
	}, []);

	const handleNewSession = useCallback(() => {
		navigate({ to: isOttoTab ? '/otto' : '/sessions' });
	}, [navigate, isOttoTab]);

	const handleSessionCreated = useCallback(
		(newSessionId: string) => {
			navigate({
				to: '/sessions/$sessionId',
				params: { sessionId: newSessionId },
				replace: false,
			});
			focusInput();
		},
		[navigate, focusInput],
	);

	const handleOttoSessionCreated = useCallback(
		(newSessionId: string) => {
			navigate({
				to: '/otto/$sessionId',
				params: { sessionId: newSessionId },
				replace: false,
			});
			focusInput();
		},
		[navigate, focusInput],
	);

	const handleDeleteSession = useCallback(() => {
		useWorkspaceTabStore
			.getState()
			.clearLastSession(isOttoTab ? 'otto' : 'agents');
		navigate({ to: isOttoTab ? '/otto' : '/sessions' });
	}, [navigate, isOttoTab]);

	const handleSelectSession = useCallback(
		(id: string) => {
			navigate({
				to: '/sessions/$sessionId',
				params: { sessionId: id },
			});
			focusInput();
		},
		[navigate, focusInput],
	);

	const handleSelectOttoSession = useCallback(
		(id: string) => {
			navigate({
				to: '/otto/$sessionId',
				params: { sessionId: id },
			});
			focusInput();
		},
		[navigate, focusInput],
	);

	const handleFixWithAI = useCallback(
		async (errorMessage: string) => {
			try {
				const session = await createSession.mutateAsync({
					agent: config?.defaults.agent || 'general',
					provider: config?.defaults.provider,
					model: config?.defaults.model,
					title: 'Fix Git Error',
				});
				navigate({
					to: '/sessions/$sessionId',
					params: { sessionId: session.id },
					replace: false,
				});
				await apiClient.sendMessage(session.id, {
					content: errorMessage,
				});
			} catch (error) {
				console.error('Failed to create fix session:', error);
			}
		},
		[createSession, config, navigate],
	);

	useEffect(() => {
		if (sessionId) {
			focusInput();
		}
	}, [sessionId, focusInput]);

	useEffect(() => {
		const win = window as Window & {
			OTTO_OPEN_SESSION?: (sessionId: string) => void | Promise<void>;
		};
		const openSession = (nextSessionId: string) => {
			handleSelectSession(nextSessionId);
		};

		win.OTTO_OPEN_SESSION = openSession;

		return () => {
			if (win.OTTO_OPEN_SESSION === openSession) {
				delete win.OTTO_OPEN_SESSION;
			}
		};
	}, [handleSelectSession]);

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			if (
				event.data?.type === 'otto-navigate-session' &&
				typeof event.data.sessionId === 'string'
			) {
				window.parent?.postMessage(
					{
						type: 'otto-navigate-session-ack',
						sessionId: event.data.sessionId,
					},
					'*',
				);
				navigate({
					to: '/sessions/$sessionId',
					params: { sessionId: event.data.sessionId },
				});
				focusInput();
			}
		};

		window.addEventListener('message', handler);
		return () => window.removeEventListener('message', handler);
	}, [navigate, focusInput]);

	const mainContent = useMemo(() => {
		if (!sessionId) {
			return (
				<NewSessionLanding
					ref={chatInputRef}
					onSessionCreated={handleSessionCreated}
				/>
			);
		}

		return (
			<>
				<MessageThreadContainer
					sessionId={sessionId}
					onSelectSession={handleSelectSession}
				/>
				<ChatInputContainer
					ref={chatInputRef}
					sessionId={sessionId}
					onNewSession={handleNewSession}
					onDeleteSession={handleDeleteSession}
				/>
			</>
		);
	}, [
		sessionId,
		handleNewSession,
		handleSelectSession,
		handleDeleteSession,
		handleSessionCreated,
	]);

	const sidebarContent = useMemo(
		() => (
			<SessionListContainer
				activeSessionId={sessionId}
				onSelectSession={handleSelectSession}
			/>
		),
		[sessionId, handleSelectSession],
	);

	return (
		<>
			<SessionRuntimeEffects sessionId={sessionId} />
			<SessionKeyboardShortcuts
				activeSessionId={sessionId}
				onNewSession={handleNewSession}
				onReturnToInput={focusInput}
				onSelectSession={handleSelectSession}
			/>
			<AppLayout
				onNewSession={handleNewSession}
				theme={theme}
				onToggleTheme={toggleTheme}
				sessionId={sessionId}
				onNavigateToSession={handleSelectSession}
				onFixWithAI={handleFixWithAI}
				sidebar={
					isOttoTab ? (
						<OttoSessionRail
							activeSessionId={sessionId}
							onSelectSession={handleSelectOttoSession}
						/>
					) : (
						sidebarContent
					)
				}
			>
				{isOttoTab ? (
					<OttoWorkspace
						ref={chatInputRef}
						sessionId={sessionId}
						onSessionCreated={handleOttoSessionCreated}
						onNewSession={handleNewSession}
						onDeleteSession={handleDeleteSession}
					/>
				) : (
					mainContent
				)}
			</AppLayout>
			<Toaster />
		</>
	);
}

function SessionRuntimeEffects({ sessionId }: SessionsLayoutProps) {
	const { data: config } = useConfig();

	useWorkingDirectory();
	useClientEvents(sessionId);
	useOttoRouterPayments(sessionId);
	useOttoRouterBalance(config?.defaults?.provider);

	return null;
}

interface SessionKeyboardShortcutsProps {
	activeSessionId?: string;
	onNewSession: () => void;
	onReturnToInput: () => void;
	onSelectSession: (sessionId: string) => void;
}

function SessionKeyboardShortcuts({
	activeSessionId,
	onNewSession,
	onReturnToInput,
	onSelectSession,
}: SessionKeyboardShortcutsProps) {
	const queryClient = useQueryClient();
	const openCommitModal = useGitStore((state) => state.openCommitModal);
	const openDiff = useGitStore((state) => state.openDiff);
	const stageFiles = useStageFiles();
	const unstageFiles = useUnstageFiles();
	const restoreFiles = useRestoreFiles();
	const deleteFiles = useDeleteFiles();
	const openConfirmation = useConfirmationStore(
		(state) => state.openConfirmation,
	);

	const getSessionIds = useCallback(() => {
		const cached =
			queryClient.getQueryData<SessionsCacheData>(sessionsQueryKey);
		return (
			cached?.pages?.flatMap((page) => page.items?.map((s) => s.id) ?? []) ?? []
		);
	}, [queryClient]);

	const handleStageFile = useCallback(
		(paths: string[]) => stageFiles.mutate(paths),
		[stageFiles],
	);

	const handleUnstageFile = useCallback(
		(paths: string[]) => unstageFiles.mutate(paths),
		[unstageFiles],
	);

	const handleRestoreFile = useCallback(
		(path: string) => restoreFiles.mutate([path]),
		[restoreFiles],
	);

	const handleDeleteFile = useCallback(
		(path: string) => {
			openConfirmation({
				title: 'Delete File',
				message: `Delete ${path}? This will permanently remove the untracked file.`,
				confirmLabel: 'Delete',
				variant: 'destructive',
				onConfirm: async () => {
					await deleteFiles.mutateAsync([path]);
				},
			});
		},
		[deleteFiles, openConfirmation],
	);

	const handleStageAll = useCallback(() => {
		const paths = useGitStore
			.getState()
			.gitTreeRows.filter((row) => row.type === 'file' && !row.staged)
			.flatMap((row) => row.actionPaths);
		if (paths.length > 0) stageFiles.mutate(Array.from(new Set(paths)));
	}, [stageFiles]);

	const handleUnstageAll = useCallback(() => {
		const paths = useGitStore
			.getState()
			.gitTreeRows.filter((row) => row.type === 'file' && row.staged)
			.flatMap((row) => row.actionPaths);
		if (paths.length > 0) unstageFiles.mutate(Array.from(new Set(paths)));
	}, [unstageFiles]);

	useKeyboardShortcuts({
		getSessionIds,
		activeSessionId,
		onSelectSession,
		onNewSession,
		onStageFile: handleStageFile,
		onUnstageFile: handleUnstageFile,
		onRestoreFile: handleRestoreFile,
		onDeleteFile: handleDeleteFile,
		onStageAll: handleStageAll,
		onUnstageAll: handleUnstageAll,
		onOpenCommitModal: openCommitModal,
		onViewDiff: openDiff,
		onReturnToInput,
	});

	return null;
}
