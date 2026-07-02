import { forwardRef, memo } from 'react';
import { NewSessionLanding } from '../chat/NewSessionLanding';
import { LooperSessionView } from './LooperSessionView';

interface LooperWorkspaceProps {
	/** Looper session to show; undefined renders the new-session landing. */
	sessionId?: string;
	/** Called with the new session id after the landing creates one. */
	onSessionCreated: (sessionId: string) => void;
	onNewSession?: () => void;
	onDeleteSession?: () => void;
}

/**
 * Main area of the Looper tab — mirrors the Agents tab exactly: a new-session
 * landing when no session is selected (chatting there creates the looper
 * session; the goal is created through that conversation) and the normal
 * session view once a session is selected. Selection is route state owned by
 * the host app (e.g. /looper/$sessionId).
 */
export const LooperWorkspace = memo(
	forwardRef<{ focus: () => void }, LooperWorkspaceProps>(
		function LooperWorkspace(
			{ sessionId, onSessionCreated, onNewSession, onDeleteSession },
			ref,
		) {
			if (sessionId) {
				return (
					<LooperSessionView
						ref={ref}
						sessionId={sessionId}
						onNewSession={onNewSession}
						onDeleteSession={onDeleteSession}
					/>
				);
			}

			return (
				<NewSessionLanding
					ref={ref}
					onSessionCreated={onSessionCreated}
					defaultAgent="looper"
					sessionType="looper"
					lockAgent
					modalPosition="absolute"
				/>
			);
		},
	),
);
