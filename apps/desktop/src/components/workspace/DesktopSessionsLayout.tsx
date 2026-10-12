import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
	getMessagesQueryKey,
	getQueueStateQueryKey,
	getSessionQueryKey,
	getSessionsQueryKey,
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
import {
	useConfirmationStore,
	useGitStore,
	useSidebarStore,
} from '@ottocode/web-sdk/stores';
import type { Project } from '../../lib/tauri-bridge';
import { tauriBridge } from '../../lib/tauri-bridge';
import {
	notificationWorkspace,
	type NotificationSessionOpen,
} from '../../lib/notification-routing';
import { createNotificationLifecycle } from '../../lib/notification-lifecycle';
import { DesktopAppLayout } from './DesktopAppLayout';

interface DesktopSessionsLayoutProps {
	project: Project;
	sessionId?: string;
	dashboardOpen: boolean;
	onCloseDashboard: () => void;
	titleBar?: ReactNode;
}

export function DesktopSessionsLayout({
	project,
	sessionId,
	dashboardOpen,
	onCloseDashboard,
	titleBar,
}: DesktopSessionsLayoutProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
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
	const notificationGeneration = useMemo(
		() => ({ project, sessionId }),
		[project, sessionId],
	);
	const notificationGenerationRef = useRef(notificationGeneration);
	notificationGenerationRef.current = notificationGeneration;

	useWorkingDirectory();
	useClientEvents(sessionId);
	useOttoRouterPayments(sessionId);
	useOttoRouterBalance(config?.defaults?.provider);

	const focusInput = useCallback(() => {
		setTimeout(() => {
			chatInputRef.current?.focus();
		}, 100);
	}, []);

	// In compact windows the sessions sidebar is a full-screen overlay, so any
	// navigation has to close it or the destination stays hidden behind it.
	const closeSidebarOverlay = useCallback(() => {
		useSidebarStore.getState().collapseForNavigation();
	}, []);

	const handleNewSession = useCallback(() => {
		closeSidebarOverlay();
		navigate({ to: '/sessions' });
		focusInput();
	}, [navigate, focusInput, closeSidebarOverlay]);

	const handleSessionCreated = useCallback(
		(newSessionId: string) => {
			closeSidebarOverlay();
			navigate({
				to: '/sessions/$sessionId',
				params: { sessionId: newSessionId },
				replace: false,
			});
			focusInput();
		},
		[navigate, focusInput, closeSidebarOverlay],
	);

	const handleDeleteSession = useCallback(() => {
		navigate({ to: '/sessions' });
	}, [navigate]);

	const handleSelectSession = useCallback(
		(id: string) => {
			closeSidebarOverlay();
			navigate({
				to: '/sessions/$sessionId',
				params: { sessionId: id },
			});
			focusInput();
		},
		[navigate, focusInput, closeSidebarOverlay],
	);

	const refreshSessionForNotificationOpen = useCallback(
		async (id: string) => {
			await Promise.allSettled([
				queryClient.fetchQuery({
					queryKey: getMessagesQueryKey(id),
					queryFn: () => apiClient.getMessages(id),
					staleTime: 0,
				}),
				queryClient.invalidateQueries({ queryKey: getQueueStateQueryKey(id) }),
				queryClient.invalidateQueries({ queryKey: getSessionQueryKey(id) }),
				queryClient.invalidateQueries({ queryKey: getSessionsQueryKey() }),
			]);
		},
		[queryClient],
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
			OTTO_SERVER_URL?: string;
			OTTO_RUNTIME_CONTEXT?: { projectId?: string };
		};
		const appWindow = getCurrentWindow();
		const workspace = notificationWorkspace(
			project,
			win.OTTO_SERVER_URL ?? project.remoteUrl ?? '',
			win.OTTO_RUNTIME_CONTEXT?.projectId,
		);
		const lifecycle = createNotificationLifecycle({
			windowLabel: appWindow.label,
			context: { workspace, project, sessionId },
			isCurrent: () =>
				notificationGenerationRef.current === notificationGeneration,
			listen: (handler) =>
				appWindow.listen<NotificationSessionOpen>(
					'otto-open-session',
					(event) => handler(event.payload),
				),
			register: (context) => tauriBridge.setNotificationWindowContext(context),
			unminimize: () => appWindow.unminimize(),
			show: () => appWindow.show(),
			focus: () => appWindow.setFocus(),
			refresh: refreshSessionForNotificationOpen,
			navigate: handleSelectSession,
			onError: (error) =>
				console.error('[otto] Notification activation failed:', error),
		});
		win.OTTO_OPEN_SESSION = lifecycle.activate;

		return () => {
			lifecycle.dispose();
			if (win.OTTO_OPEN_SESSION === lifecycle.activate) {
				delete win.OTTO_OPEN_SESSION;
			}
		};
	}, [
		handleSelectSession,
		refreshSessionForNotificationOpen,
		project,
		sessionId,
		notificationGeneration,
	]);

	useEffect(() => {
		if (sessionId) {
			focusInput();
		}
	}, [sessionId, focusInput]);

	const mainContent = useMemo(() => {
		if (!sessionId) {
			return (
				<NewSessionLanding
					ref={chatInputRef}
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
				sessionId={sessionId}
				onNavigateToSession={handleSelectSession}
				onFixWithAI={handleFixWithAI}
				dashboardOpen={dashboardOpen}
				onOpenDashboard={handleOpenDashboard}
				onCloseDashboard={onCloseDashboard}
				titleBar={titleBar}
				sidebar={
					<div className="flex h-full min-h-0 flex-col pt-12">
						<div className="min-h-0 flex-1">
							<SessionListContainer
								activeSessionId={sessionId}
								onSelectSession={handleSelectSession}
							/>
						</div>
					</div>
				}
			>
				{mainContent}
			</DesktopAppLayout>
			<Toaster />
		</>
	);
}
