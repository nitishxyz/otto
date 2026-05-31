import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
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
	useOttoRouterPayments,
	useRestoreFiles,
	useSessions,
	useStageFiles,
	useUnstageFiles,
	useWorkingDirectory,
} from '@ottocode/web-sdk/hooks';
import { apiClient } from '@ottocode/web-sdk/lib';
import { useConfirmationStore, useGitStore } from '@ottocode/web-sdk/stores';
import type { Theme } from '@ottocode/web-sdk/hooks';
import type { Project } from '../../lib/tauri-bridge';
import { DesktopAppLayout } from './DesktopAppLayout';

interface DesktopSessionsLayoutProps {
	project: Project;
	theme: Theme;
	onToggleTheme: () => void;
	sessionId?: string;
	dashboardOpen: boolean;
	onCloseDashboard: () => void;
}

export function DesktopSessionsLayout({
	project,
	theme,
	onToggleTheme,
	sessionId,
	dashboardOpen,
	onCloseDashboard,
}: DesktopSessionsLayoutProps) {
	const navigate = useNavigate();
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
	const defaultAgent =
		project.kind === 'general' ? 'general' : config?.defaults.agent;

	useWorkingDirectory();
	useClientEvents(sessionId);
	useOttoRouterPayments(sessionId);
	useOttoRouterBalance(config?.defaults?.provider);

	const focusInput = useCallback(() => {
		setTimeout(() => {
			chatInputRef.current?.focus();
		}, 100);
	}, []);

	const handleNewSession = useCallback(() => {
		navigate({ to: '/sessions' });
		focusInput();
	}, [navigate, focusInput]);

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

	const handleOpenDashboard = useCallback(() => {
		navigate({ to: '/dashboard' });
	}, [navigate]);

	const handleFixWithAI = useCallback(
		async (errorMessage: string) => {
			try {
				const session = await createSession.mutateAsync({
					agent: defaultAgent || 'general',
					provider: config?.defaults.provider,
					model: config?.defaults.model,
					title: 'Fix Git Error',
				});
				navigate({
					to: '/sessions/$sessionId',
					params: { sessionId: session.id },
				});
				await apiClient.sendMessage(session.id, {
					content: errorMessage,
				});
			} catch (error) {
				console.error('Failed to create fix session:', error);
			}
		},
		[createSession, config, defaultAgent, navigate],
	);

	const handleCopyText = useCallback(async (text: string) => {
		await invoke('copy_to_clipboard', { text });
	}, []);

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
		onSelectSession: handleSelectSession,
		onNewSession: handleNewSession,
		onStageFile: (paths) =>
			stageFiles.mutate(Array.isArray(paths) ? paths : [paths]),
		onUnstageFile: (paths) =>
			unstageFiles.mutate(Array.isArray(paths) ? paths : [paths]),
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
		const win = window as Window & {
			OTTO_OPEN_SESSION?: (sessionId: string) => void | Promise<void>;
		};
		let unlisten: (() => void) | undefined;
		win.OTTO_OPEN_SESSION = async (nextSessionId: string) => {
			const appWindow = getCurrentWindow();
			await appWindow.unminimize().catch(() => {});
			await appWindow.show().catch(() => {});
			await appWindow.setFocus().catch(() => {});
			handleSelectSession(nextSessionId);
		};
		getCurrentWindow()
			.listen<string>('otto-open-session', (event) => {
				void win.OTTO_OPEN_SESSION?.(event.payload);
			})
			.then((nextUnlisten) => {
				unlisten = nextUnlisten;
			})
			.catch((error: unknown) => {
				console.error('[otto] Failed to listen for session opens:', error);
			});

		return () => {
			unlisten?.();
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
			return (
				<NewSessionLanding
					defaultAgent={defaultAgent}
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
					onCopyText={handleCopyText}
				/>
			</>
		);
	}, [
		sessionId,
		handleNewSession,
		handleSelectSession,
		handleDeleteSession,
		handleCopyText,
		handleSessionCreated,
		defaultAgent,
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
				dashboardOpen={dashboardOpen}
				onOpenDashboard={handleOpenDashboard}
				onCloseDashboard={onCloseDashboard}
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
