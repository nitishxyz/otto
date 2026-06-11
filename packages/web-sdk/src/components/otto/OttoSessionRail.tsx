import { memo } from 'react';
import { useOttoEnabled } from '../../hooks/useGoals';
import { SessionListContainer } from '../sessions/SessionListContainer';

interface OttoSessionRailProps {
	activeSessionId?: string;
	onSelectSession: (sessionId: string) => void;
}

/**
 * Left rail for the Otto tab: lists otto sessions using the same
 * session-list primitive as the Agents tab. Selection is route state owned
 * by the host app (e.g. navigating to /otto/$sessionId). Renders nothing
 * when otto is disabled on the server (`useOttoEnabled()`).
 */
export const OttoSessionRail = memo(function OttoSessionRail({
	activeSessionId,
	onSelectSession,
}: OttoSessionRailProps) {
	const ottoEnabled = useOttoEnabled();
	if (!ottoEnabled) return null;
	return (
		<SessionListContainer
			sessionType="otto"
			activeSessionId={activeSessionId}
			onSelectSession={onSelectSession}
			emptyMessage="No otto sessions yet. Start chatting to create one."
		/>
	);
});
