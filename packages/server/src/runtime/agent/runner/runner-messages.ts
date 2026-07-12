import type { ModelMessage } from 'ai';

const CONTINUATION_PROMPT =
	'Continue the task from the current state. Do not repeat work already completed.';

/** Ensures providers receive a user turn rather than an assistant prefill. */
export function ensureUserTurnBeforeAssistantRun(
	messages: ModelMessage[],
): ModelMessage[] {
	if (messages.at(-1)?.role !== 'assistant') return messages;
	return [...messages, { role: 'user', content: CONTINUATION_PROMPT }];
}
