import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
	ChatInputContainer,
	MessageThreadContainer,
	NewSessionLanding,
	SessionListContainer,
	Toaster,
	type ChatInputContainerRef,
} from '@ottocode/web-sdk/components';
import {
	useClientEvents,
	useConfig,
	useCreateSession,
	useDeleteFiles,
	useGitStatus,
	useKeyboardShortcuts,
	useOttoRouterBalance,
	useRestoreFiles,
	useSessions,
	useSetuPayments,
	useStageFiles,
	useUnstageFiles,
	useWorkingDirectory,
} from '@ottocode/web-sdk/hooks';
import { apiClient } from '@ottocode/web-sdk/lib';
import { useConfirmationStore, useGitStore } from '@ottocode/web-sdk/stores';
import type { Theme } from '@ottocode/web-sdk/hooks';
import { DesktopAppLayout } from './DesktopAppLayout';

interface DesktopSessionsLayoutProps {
	theme: Theme;
	onToggleTheme: () => void;
}

export function DesktopSessionsLayout({
	theme,
	onToggleTheme,
}: DesktopSessionsLayoutProps) {
	const [sessionId, setSessionId] = useState<string | undefined>();
	const chatInputRef = useRef<ChatInputContainerRef>(null);
	const createSession = useCreateSession();
	const { data: config } = useConfig();
	const { openCommitModal, openDiff } = useGitStore();
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
		setSessionId(undefined);
		focusInput();
	}, [focusInput]);

	const handleSessionCreated = useCallback(
		(newSessionId: string) => {
			setSessionId(newSessionId);
			focusInput();
		},
		[focusInput],
	);

	const handleDeleteSession = useCallback(() => {
		setSessionId(undefined);
	}, []);

	const handleSelectSession = useCallback(
		(id: string) => {
			setSessionId(id);
			focusInput();
		},
		[focusInput],
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
				setSessionId(session.id);
				await apiClient.sendMessage(session.id, {
					content: errorMessage,
				});
			} catch (error) {
				console.error('Failed to create fix session:', error);
			}
		},
		[createSession, config],
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
			const unstaged = gitFiles.filter((f) => !f.staged).map((f) => f.path);
			if (unstaged.length > 0) stageFiles.mutate(unstaged);
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
		const win = window as Window & {
			OTTO_OPEN_SESSION?: (sessionId: string) => void | Promise<void>;
		};
		win.OTTO_OPEN_SESSION = async (nextSessionId: string) => {
			const appWindow = getCurrentWindow();
			await appWindow.unminimize().catch(() => {});
			await appWindow.show().catch(() => {});
			await appWindow.setFocus().catch(() => {});
			handleSelectSession(nextSessionId);
		};

		return () => {
			if (win.OTTO_OPEN_SESSION) {
				delete win.OTTO_OPEN_SESSION;
			}
		};
	}, [handleSelectSession]);

	useEffect(() => {
		if (sessionId) {
			focusInput();
		}
	}, [sessionId, focusInput]);

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
			<DesktopAppLayout
				onNewSession={handleNewSession}
				theme={theme}
				onToggleTheme={onToggleTheme}
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
			</DesktopAppLayout>
			<Toaster />
		</>
	);
}
