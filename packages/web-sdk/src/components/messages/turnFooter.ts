import type { Message } from '../../types/api';

/**
 * Determines whether the Branch/Copy turn footer should render for an
 * assistant message group.
 *
 * The footer (and its reserved vertical space) must appear at most once per
 * assistant turn. A single visual turn can contain multiple assistant messages
 * after auto-compaction, backend retries, or automatic/user retry. To avoid
 * duplicate footer gaps, the footer renders only on the last assistant message
 * of a contiguous assistant run.
 *
 * @param message - The assistant message being rendered.
 * @param sessionId - The active session id, if any.
 * @param hasNextAssistantMessage - Whether the next message is also an
 *   assistant message in the same turn.
 */
export function shouldRenderTurnFooter(
	message: Pick<Message, 'status'>,
	sessionId: string | undefined,
	hasNextAssistantMessage: boolean,
): boolean {
	return (
		message.status === 'complete' &&
		Boolean(sessionId) &&
		!hasNextAssistantMessage
	);
}
