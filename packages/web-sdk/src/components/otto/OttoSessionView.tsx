import { forwardRef, memo } from 'react';
import { MessageThreadContainer } from '../messages/MessageThreadContainer';
import { ChatInputContainer } from '../chat/ChatInputContainer';
import { OttoGoalBar } from './OttoGoalBar';

interface OttoSessionViewProps {
	sessionId: string;
	onNewSession?: () => void;
	onDeleteSession?: () => void;
}

/**
 * An otto session rendered with the standard session experience: the normal
 * message thread (SessionHeader/LeanHeader included) and the full chat input
 * (provider/model editable; agent locked to otto). The goals bar attaches to
 * the chat input alongside InputTodosBar — the session header stays clean.
 */
export const OttoSessionView = memo(
	forwardRef<{ focus: () => void }, OttoSessionViewProps>(
		function OttoSessionView(
			{ sessionId, onNewSession, onDeleteSession },
			ref,
		) {
			return (
				<div className="relative flex h-full min-h-0 flex-col overflow-hidden">
					<MessageThreadContainer sessionId={sessionId} forceCompact />
					<ChatInputContainer
						ref={ref}
						sessionId={sessionId}
						modalPosition="absolute"
						lockedAgent
						onNewSession={onNewSession}
						onDeleteSession={onDeleteSession}
						topBars={<OttoGoalBar sessionId={sessionId} />}
					/>
				</div>
			);
		},
	),
);
