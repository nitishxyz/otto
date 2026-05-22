import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '../layout/AppLayout';
import {
	SessionListContainer,
	MessageThreadContainer,
	ChatInputContainer,
	NewSessionLanding,
	type ChatInputContainerRef,
	Toaster,
} from '@ottocode/web-sdk/components';
import {
	useCreateSession,
	useConfig,
	useTheme,
	useWorkingDirectory,
	useKeyboardShortcuts,
	useClientEvents,
} from '@ottocode/web-sdk/hooks';
import { useGitStore, useConfirmationStore } from '@ottocode/web-sdk/stores';
import { apiClient } from '@ottocode/web-sdk/lib';
import {
	useGitStatus,
	useStageFiles,
	useOttoRouterBalance,
	useSetuPayments,
	useUnstageFiles,
	useRestoreFiles,
	useDeleteFiles,
	useSessions,
} from '@ottocode/web-sdk/hooks';

interface SessionsLayoutProps {
	sessionId?: string;
}

export function SessionsLayout({ sessionId }: SessionsLayoutProps) {
	const chatInputRef = useRef<ChatInputContainerRef>(null);
	const createSession = useCreateSession();
	const { data: config } = useConfig();
	const { theme, toggleTheme } = useTheme();
	const { openCommitModal, openDiff } = useGitStore();
	const navigate = useNavigate();
	const { data: sessions = [] } = useSessions();
	const { data: gitStatus } = useGitStatus();
	const stageFiles = useStageFiles();
	const unstageFiles = useUnstageFiles();
	const restoreFiles = useRestoreFiles();
	const deleteFiles = useDeleteFiles();
	const openConfirmation = useConfirmationStore(
		(state) => state.openConfirmation,
	);

	useWorkingDirectory();
	useClientEvents(sessionId);
	useSetuPayments(sessionId);
	useOttoRouterBalance(config?.defaults?.provider);

	const focusInput = useCallback(() => {
		setTimeout(() => {
			chatInputRef.current?.focus();
		}, 100);
	}, []);

	const handleNewSession = useCallback(() => {
		navigate({ to: '/sessions' });
	}, [navigate]);

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

	const handleDeleteSession = useCallback(() => {
		navigate({ to: '/sessions' });
	}, [navigate]);

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

	const gitFiles = useMemo(() => {
		if (!gitStatus) return [];
		return [
			...(gitStatus.conflicted ?? []).map((f) => ({
				path: f.path,
				staged: false,
				status: f.status,
			})),
			...gitStatus.staged.map((f) => ({
				path: f.path,
				staged: true,
				status: f.status,
			})),
			...gitStatus.unstaged.map((f) => ({
				path: f.path,
				staged: false,
				status: f.status,
			})),
			...gitStatus.untracked.map((f) => ({
				path: f.path,
				staged: false,
				status: f.status,
			})),
		];
	}, [gitStatus]);

	const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

	useKeyboardShortcuts({
		sessionIds,
		activeSessionId: sessionId,
		gitFiles,
		onSelectSession: handleSelectSession,
		onNewSession: handleNewSession,
		onStageFile: (path) => stageFiles.mutate([path]),
		onUnstageFile: (path) => unstageFiles.mutate([path]),
		onRestoreFile: (path) => restoreFiles.mutate([path]),
		onDeleteFile: (path) => {
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
		onStageAll: () => {
			if (gitFiles.some((f) => !f.staged)) stageFiles.mutate(['.']);
		},
		onUnstageAll: () => {
			const staged = gitFiles.filter((f) => f.staged).map((f) => f.path);
			if (staged.length > 0) unstageFiles.mutate(staged);
		},
		onOpenCommitModal: openCommitModal,
		onViewDiff: openDiff,
		onReturnToInput: focusInput,
	});

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
			return <NewSessionLanding onSessionCreated={handleSessionCreated} />;
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

	return (
		<>
			<AppLayout
				onNewSession={handleNewSession}
				theme={theme}
				onToggleTheme={toggleTheme}
				sessionId={sessionId}
				onNavigateToSession={handleSelectSession}
				onFixWithAI={handleFixWithAI}
				sidebar={
					<SessionListContainer
						activeSessionId={sessionId}
						onSelectSession={handleSelectSession}
					/>
				}
			>
				{mainContent}
			</AppLayout>
			<Toaster />
		</>
	);
}
