import type { ModelMessage } from 'ai';

const CONTINUATION_PROMPT =
	'Continue the task from the current state. Do not repeat work already completed.';

/** Ensures a run has input and providers receive a user turn, not a prefill. */
export function ensureUserTurnBeforeAssistantRun(
	messages: ModelMessage[],
): ModelMessage[] {
	if (messages.length === 0) {
		return [{ role: 'user', content: CONTINUATION_PROMPT }];
	}
	if (messages.at(-1)?.role !== 'assistant') return messages;
	return [...messages, { role: 'user', content: CONTINUATION_PROMPT }];
}
