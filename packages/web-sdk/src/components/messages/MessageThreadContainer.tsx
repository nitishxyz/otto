import { memo, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMessages } from '../../hooks/useMessages';
import { useSessionStream } from '../../hooks/useSessionStream';
import { sessionsQueryKey, useSessions } from '../../hooks/useSessions';
import { usePreferences } from '../../hooks/usePreferences';
import { MessageThread } from './MessageThread';
import { useToolApprovalShortcuts } from '../../hooks/useToolApprovalShortcuts';
import { OttoRouterTopupModal } from '../settings/OttoRouterTopupModal';

interface MessageThreadContainerProps {
	sessionId: string;
	onSelectSession?: (sessionId: string) => void;
	footerBottomPaddingClass?: string;
}

export const MessageThreadContainer = memo(function MessageThreadContainer({
	sessionId,
	onSelectSession,
	footerBottomPaddingClass,
}: MessageThreadContainerProps) {
	return (
		<>
			<SessionStreamController sessionId={sessionId} />
			<ToolApprovalShortcutController sessionId={sessionId} />
			<MessageThreadData
				sessionId={sessionId}
				onSelectSession={onSelectSession}
				footerBottomPaddingClass={footerBottomPaddingClass}
			/>
			<TopupModalHost />
		</>
	);
});

function SessionStreamController({ sessionId }: { sessionId: string }) {
	const queryClient = useQueryClient();

	useSessionStream(sessionId);

	useEffect(() => {
		queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
		queryClient.invalidateQueries({ queryKey: ['queueState', sessionId] });
		queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
	}, [queryClient, sessionId]);

	return null;
}

function ToolApprovalShortcutController({ sessionId }: { sessionId: string }) {
	useToolApprovalShortcuts(sessionId);
	return null;
}

function TopupModalHost() {
	return <OttoRouterTopupModal />;
}

const MessageThreadData = memo(function MessageThreadData({
	sessionId,
	onSelectSession,
	footerBottomPaddingClass,
}: MessageThreadContainerProps) {
	const { data: messages = [], isLoading } = useMessages(sessionId);
	const { data: sessions = [] } = useSessions();
	const { preferences } = usePreferences();

	const session = useMemo(
		() => sessions.find((s) => s.id === sessionId),
		[sessions, sessionId],
	);

	const isGenerating = useMemo(
		() =>
			messages.some((m) => m.role === 'assistant' && m.status === 'pending'),
		[messages],
	);

	if (isLoading) {
		return (
			<div className="flex-1 flex items-center justify-center text-muted-foreground">
				Loading messages...
			</div>
		);
	}

	return (
		<MessageThread
			messages={messages}
			sessionId={sessionId}
			session={session}
			isGenerating={isGenerating}
			compact={preferences.compactThread}
			onSelectSession={onSelectSession}
			footerBottomPaddingClass={footerBottomPaddingClass}
		/>
	);
});
