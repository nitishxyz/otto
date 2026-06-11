import { memo } from 'react';
import { SessionListContainer } from '../sessions/SessionListContainer';

interface OttoSessionRailProps {
	activeSessionId?: string;
	onSelectSession: (sessionId: string) => void;
}

/**
 * Left rail for the Otto tab: lists otto sessions using the same
 * session-list primitive as the Agents tab. Selection is route state owned
 * by the host app (e.g. navigating to /otto/$sessionId).
 */
export const OttoSessionRail = memo(function OttoSessionRail({
	activeSessionId,
	onSelectSession,
}: OttoSessionRailProps) {
	return (
		<SessionListContainer
			sessionType="otto"
			activeSessionId={activeSessionId}
			onSelectSession={onSelectSession}
			emptyMessage="No otto sessions yet. Start chatting to create one."
		/>
	);
});
