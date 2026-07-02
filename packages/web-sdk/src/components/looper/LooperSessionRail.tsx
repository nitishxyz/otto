import { memo } from 'react';
import { SessionListContainer } from '../sessions/SessionListContainer';

interface LooperSessionRailProps {
	activeSessionId?: string;
	onSelectSession: (sessionId: string) => void;
	/** See SessionListContainer: host floats an h-12 header over the list. */
	hasOverlayHeader?: boolean;
}

/**
 * Left rail for the Looper tab: lists looper sessions using the same
 * session-list primitive as the Agents tab. Selection is route state owned
 * by the host app (e.g. navigating to /looper/$sessionId).
 */
export const LooperSessionRail = memo(function LooperSessionRail({
	activeSessionId,
	onSelectSession,
	hasOverlayHeader,
}: LooperSessionRailProps) {
	return (
		<SessionListContainer
			sessionType="looper"
			activeSessionId={activeSessionId}
			onSelectSession={onSelectSession}
			emptyMessage="No looper sessions yet. Start chatting to create one."
			hasOverlayHeader={hasOverlayHeader}
		/>
	);
});
