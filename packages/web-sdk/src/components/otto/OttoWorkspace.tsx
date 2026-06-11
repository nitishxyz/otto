import { memo } from 'react';
import { Target } from 'lucide-react';
import { useOttoEnabled } from '../../hooks/useGoals';
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
 * the host app (e.g. /otto/$sessionId). When otto is disabled on the server
 * (`useOttoEnabled()`), shows a disabled notice instead — hosts should
 * ideally not route here at all in that case.
 */
export const OttoWorkspace = memo(function OttoWorkspace({
	sessionId,
	onSessionCreated,
	onNewSession,
	onDeleteSession,
}: OttoWorkspaceProps) {
	const ottoEnabled = useOttoEnabled();

	if (!ottoEnabled) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
				<Target className="h-6 w-6 text-muted-foreground" />
				<p className="text-sm font-medium text-foreground">Otto is disabled</p>
				<p className="max-w-sm text-xs text-muted-foreground">
					Otto is turned off on this server. Enable it in the server config to
					use goal orchestration.
				</p>
			</div>
		);
	}

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
