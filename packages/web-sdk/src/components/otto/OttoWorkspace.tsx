import { memo } from 'react';
import { NewSessionLanding } from '../chat/NewSessionLanding';
import { OttoSessionView } from './OttoSessionView';

interface OttoWorkspaceProps {
	/** Otto session to show; undefined renders the new-session landing. */
	sessionId?: string;
	/** Called with the new session id after the landing creates one. */
	onSessionCreated: (sessionId: string) => void;
	onNewSession?: () => void;
	onDeleteSession?: () => void;
}

/**
 * Main area of the Otto tab — mirrors the Agents tab exactly: a new-session
 * landing when no session is selected (chatting there creates the otto
 * session; the goal is created through that conversation) and the normal
 * session view once a session is selected. Selection is route state owned by
 * the host app (e.g. /otto/$sessionId).
 */
export const OttoWorkspace = memo(function OttoWorkspace({
	sessionId,
	onSessionCreated,
	onNewSession,
	onDeleteSession,
}: OttoWorkspaceProps) {
	if (sessionId) {
		return (
			<OttoSessionView
				sessionId={sessionId}
				onNewSession={onNewSession}
				onDeleteSession={onDeleteSession}
			/>
		);
	}

	return (
		<NewSessionLanding
			onSessionCreated={onSessionCreated}
			defaultAgent="otto"
			sessionType="otto"
			lockAgent
			modalPosition="absolute"
		/>
	);
});
