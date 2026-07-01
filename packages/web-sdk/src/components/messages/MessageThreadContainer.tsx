import { memo, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMessages } from '../../hooks/useMessages';
import { useSessionStream } from '../../hooks/useSessionStream';
import { getSessionsQueryKey, useSession } from '../../hooks/useSessions';
import { getQueueStateQueryKey } from '../../hooks/useQueueState';
import { usePreferences } from '../../hooks/usePreferences';
import { MessageThread } from './MessageThread';
import { useToolApprovalShortcuts } from '../../hooks/useToolApprovalShortcuts';
import { OttoRouterTopupModal } from '../settings/OttoRouterTopupModal';

interface MessageThreadContainerProps {
	sessionId: string;
	onSelectSession?: (sessionId: string) => void;
	footerBottomPaddingClass?: string;
	/**
	 * Force the compact thread renderer regardless of user preference. Used by
	 * otto orchestrator threads so otto's verify/complete/dispatch tool calls
	 * collapse into compact activity events instead of message bubbles.
	 */
	forceCompact?: boolean;
}

export const MessageThreadContainer = memo(function MessageThreadContainer({
	sessionId,
	onSelectSession,
	footerBottomPaddingClass,
	forceCompact,
}: MessageThreadContainerProps) {
	return (
		<>
			<SessionStreamController sessionId={sessionId} />
			<ToolApprovalShortcutController sessionId={sessionId} />
			<MessageThreadData
				sessionId={sessionId}
				onSelectSession={onSelectSession}
				footerBottomPaddingClass={footerBottomPaddingClass}
				forceCompact={forceCompact}
			/>
			<TopupModalHost />
		</>
	);
});

function SessionStreamController({ sessionId }: { sessionId: string }) {
	const queryClient = useQueryClient();

	useSessionStream(sessionId);

	useEffect(() => {
		queryClient.invalidateQueries({
			queryKey: getQueueStateQueryKey(sessionId),
		});
		queryClient.invalidateQueries({ queryKey: getSessionsQueryKey() });
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
	forceCompact,
}: MessageThreadContainerProps) {
	const { data: messages = [], isLoading } = useMessages(sessionId);
	const session = useSession(sessionId);
	const { preferences } = usePreferences();

	// Otto orchestrator threads always use the compact renderer so otto's
	// verify/complete/dispatch tool activity collapses into activity events.
	const isOttoThread = forceCompact || session?.sessionType === 'otto';

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
			compact={isOttoThread || preferences.compactThread}
			responsiveCompact={preferences.compactThread}
			onSelectSession={onSelectSession}
			footerBottomPaddingClass={footerBottomPaddingClass}
		/>
	);
});
