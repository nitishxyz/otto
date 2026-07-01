import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ChatInputContainer,
	MessageThreadContainer,
	NewSessionLanding,
	getMessagesQueryKey,
	getSessionsQueryKey,
	useMessages,
	type ChatInputContainerRef,
	type NewSessionLandingRef,
} from '@ottocode/web-sdk';
import type { Block } from '../stores/canvas-store';
import { useCanvasStore } from '../stores/canvas-store';
import { useTabActivityStore } from '../stores/tab-activity-store';
import { useWorkspaceRuntimeStore } from '../stores/workspace-runtime-store';

interface OttoBlockProps {
	block: Block;
	isFocused: boolean;
	workspaceId: string;
}

function OttoRuntimeState({
	title,
	description,
	isLoading = false,
}: {
	title: string;
	description: string;
	isLoading?: boolean;
}) {
	return (
		<div className="flex h-full items-center justify-center px-6">
			<div className="max-w-md space-y-3 text-center">
				{isLoading ? (
					<LoaderCircle size={24} className="mx-auto animate-spin text-canvas-text-muted" />
				) : null}
				<p className="text-[13px] font-medium text-canvas-text-dim">{title}</p>
				<p className="whitespace-pre-wrap break-words text-[11px] leading-5 text-canvas-text-muted">{description}</p>
			</div>
		</div>
	);
}

export function OttoBlock({ block, isFocused, workspaceId }: OttoBlockProps) {
	const [sessionId, setSessionId] = useState<string | null>(block.sessionId ?? null);
	const queryClient = useQueryClient();
	const runtime = useWorkspaceRuntimeStore((s) =>
		workspaceId ? s.runtimes[workspaceId] ?? null : null,
	);
	const setFocused = useCanvasStore((s) => s.setFocused);
	const setBlockSessionId = useCanvasStore((s) => s.setBlockSessionId);
	const containerRef = useRef<HTMLDivElement>(null);
	const chatInputRef = useRef<ChatInputContainerRef>(null);
	const landingRef = useRef<NewSessionLandingRef>(null);

	const setActivityStatus = useTabActivityStore((s) => s.setStatus);

	const isOttoLoading = !runtime || runtime.status === 'starting' || runtime.status === 'stopped';
	const { data: messages = [] } = useMessages(
		sessionId ?? undefined,
		{ enabled: !!sessionId && runtime?.status === 'ready' },
	);
	const isGenerating = useMemo(
		() => messages.some((m) => m.role === 'assistant' && m.status === 'pending'),
		[messages],
	);

	useEffect(() => {
		if (isOttoLoading) {
			setActivityStatus(block.id, 'loading', 'Starting Otto runtime…');
		} else if (isGenerating) {
			setActivityStatus(block.id, 'busy', 'Generating…');
		} else {
			setActivityStatus(block.id, 'idle');
		}
	}, [block.id, isOttoLoading, isGenerating, setActivityStatus]);

	useEffect(() => {
		setSessionId(block.sessionId ?? null);
	}, [block.sessionId]);

	useEffect(() => {
		if (!sessionId || runtime?.status !== 'ready') return;
		void queryClient.invalidateQueries({ queryKey: getSessionsQueryKey() });
		void queryClient.invalidateQueries({
			queryKey: getMessagesQueryKey(sessionId),
		});
	}, [queryClient, runtime?.status, sessionId, workspaceId]);

	useEffect(() => {
		if (!isFocused) return;

		const focusInput = () => {
			void getCurrentWebview().setFocus().catch(() => undefined);
			containerRef.current?.focus();
			if (sessionId && runtime?.status === 'ready') {
				chatInputRef.current?.focus();
			} else {
				landingRef.current?.focus();
			}
			const focusTarget = containerRef.current?.querySelector<HTMLElement>(
				'textarea, input, [contenteditable="true"], [contenteditable=""]',
			);
			focusTarget?.focus();
		};

		const timeouts = [0, 30, 120, 260, 500].map((delay) =>
			window.setTimeout(focusInput, delay),
		);

		return () => {
			for (const timeout of timeouts) {
				window.clearTimeout(timeout);
			}
		};
	}, [isFocused, runtime?.status, sessionId]);

	const handleSessionCreated = useCallback(
		(id: string) => {
			setSessionId(id);
			setBlockSessionId(block.id, id, workspaceId);
		},
		[block.id, setBlockSessionId, workspaceId],
	);

	const handleNewSession = useCallback(() => {
		setSessionId(null);
		setBlockSessionId(block.id, null, workspaceId);
	}, [block.id, setBlockSessionId, workspaceId]);

	const handleSelectSession = useCallback(
		(id: string) => {
			setSessionId(id);
			setBlockSessionId(block.id, id, workspaceId);
		},
		[block.id, setBlockSessionId, workspaceId],
	);

	return (
		<div
			ref={containerRef}
			tabIndex={-1}
			className="dark relative flex h-full w-full select-text flex-col overflow-hidden outline-none"
			style={{ background: 'hsl(var(--background))' }}
			onMouseDownCapture={() => setFocused(block.id)}
			onFocusCapture={() => setFocused(block.id)}
			onClick={() => setFocused(block.id)}
		>
			{!workspaceId ? (
				<OttoRuntimeState
					title="No workspace selected"
					description="Open a workspace to start an Otto runtime for this block."
				/>
			) : !runtime || runtime.status === 'starting' || runtime.status === 'stopped' ? (
				<OttoRuntimeState
					title="Starting Otto for this workspace"
					description="Canvas is launching `otto serve --no-open` in the workspace root."
					isLoading
				/>
			) : runtime.status === 'error' || !runtime.url ? (
				<OttoRuntimeState
					title="Otto runtime unavailable"
					description={runtime.error ?? 'Failed to start the workspace Otto runtime.'}
				/>
			) : sessionId ? (
				<>
					<div className="relative flex-1 min-h-0">
						<MessageThreadContainer
							sessionId={sessionId}
							onSelectSession={handleSelectSession}
						/>
					</div>
					<div className="flex-shrink-0 border-t border-border px-2 pb-2">
						<ChatInputContainer
							ref={chatInputRef}
							sessionId={sessionId}
							onNewSession={handleNewSession}
							modalPosition="absolute"
						/>
					</div>
				</>
			) : (
				<NewSessionLanding
					ref={landingRef}
					onSessionCreated={handleSessionCreated}
					compact
					modalPosition="absolute"
				/>
			)}
		</div>
	);
}
