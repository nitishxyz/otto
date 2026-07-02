import { forwardRef, memo } from 'react';
import { MessageThreadContainer } from '../messages/MessageThreadContainer';
import { ChatInputContainer } from '../chat/ChatInputContainer';
import { LooperGoalBar } from './LooperGoalBar';

interface LooperSessionViewProps {
	sessionId: string;
	onNewSession?: () => void;
	onDeleteSession?: () => void;
}

/**
 * A looper session rendered with the standard session experience: the normal
 * message thread (SessionHeader/LeanHeader included) and the full chat input
 * (provider/model editable; agent locked to looper). The goals bar attaches
 * to the chat input alongside InputTodosBar — the session header stays clean.
 */
export const LooperSessionView = memo(
	forwardRef<{ focus: () => void }, LooperSessionViewProps>(
		function LooperSessionView(
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
						topBars={<LooperGoalBar sessionId={sessionId} />}
					/>
				</div>
			);
		},
	),
);
